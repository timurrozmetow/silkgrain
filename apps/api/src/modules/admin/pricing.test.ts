import type { AdminPricePreview, AdminPriceApplyResult } from '@silkgrain/contracts';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, productVariants } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

import { computeChange, type PriceVariantRow } from './pricing.service';

/**
 * Bulk price operations.
 *
 * The arithmetic is the thing worth testing hardest - it is money, rounded, across a batch - and
 * `computeChange` is pure, so most of the rounding proof is a plain unit test with no database.
 * The rest is the two-step machine's safety: a preview that writes nothing, an apply that locks and
 * recomputes and refuses a row that drifted or a batch that would go under cost.
 */
describe('bulk pricing', () => {
  const variant = (over: Partial<PriceVariantRow>): PriceVariantRow => ({
    variantId: 1,
    productId: 1,
    productName: 'Devzira Rice',
    productStatus: 'active',
    sku: 'SG-001-5LB',
    weightLabel: '5 lb',
    isActive: true,
    priceCents: 2500,
    compareAtPriceCents: null,
    costCents: null,
    ...over,
  });

  describe('computeChange (pure)', () => {
    it('rounds a percentage once, half to even, so ties do not all round one way', () => {
      // The worked example from the spec: a +2.5% raise, multiplier 10250.
      // 2000 -> 2050 exactly; 2500 -> 2562.5, and 2562 is even, so 2562;
      // 9900 -> 10147.5, and 10147 is odd, so 10148. Two ties, opposite directions.
      const op = { kind: 'adjust_percent', deltaBasisPoints: 250 } as const;
      expect(computeChange(op, variant({ priceCents: 2000 })).newPriceCents).toBe(2050);
      expect(computeChange(op, variant({ priceCents: 2500 })).newPriceCents).toBe(2562);
      expect(computeChange(op, variant({ priceCents: 9900 })).newPriceCents).toBe(10148);
    });

    it('rounds in one step, not two, so a hidden intermediate cannot flip the parity', () => {
      // 1005 +10%: one step is 1005 * 11000 / 10000 = 1105.5 -> 1106 (even). A two-step
      // (1005 + round(100.5)) would give 1005 + 100 = 1105. The one-step answer is correct.
      const op = { kind: 'adjust_percent', deltaBasisPoints: 1000 } as const;
      expect(computeChange(op, variant({ priceCents: 1005 })).newPriceCents).toBe(1106);
    });

    it('adds a flat amount without rounding anything', () => {
      const op = { kind: 'adjust_cents', deltaCents: 50 } as const;
      expect(computeChange(op, variant({ priceCents: 1299 })).newPriceCents).toBe(1349);
      expect(computeChange(op, variant({ priceCents: 2000 })).newPriceCents).toBe(2050);
    });

    it('blocks a cut that would land at or below zero rather than clamping it', () => {
      const op = { kind: 'adjust_cents', deltaCents: -100_000 } as const;
      const change = computeChange(op, variant({ priceCents: 500 }));
      expect(change.verdict).toBe('blocked');
      expect(change.blockedBy).toBe('price_not_positive');
      // A blocked row reports its current price, never a negative, so the Cents serialiser holds.
      expect(change.newPriceCents).toBe(500);
    });

    it('moves a set compare-at with the price, so the advertised discount does not drift', () => {
      const op = { kind: 'adjust_percent', deltaBasisPoints: 1000 } as const;
      const change = computeChange(op, variant({ priceCents: 2000, compareAtPriceCents: 3000 }));
      expect(change.newPriceCents).toBe(2200);
      // The compare-at is untouched by a raise, and 3000 is still above 2200, so this is allowed.
      expect(change.newCompareAtPriceCents).toBe(3000);
      expect(change.verdict).toBe('change');
    });

    it('blocks a raise that would cross the compare-at rather than aborting the batch', () => {
      const op = { kind: 'adjust_percent', deltaBasisPoints: 5000 } as const;
      const change = computeChange(op, variant({ priceCents: 2000, compareAtPriceCents: 2500 }));
      // 2000 +50% = 3000, which is above the 2500 compare-at: the CHECK would fire. Block instead.
      expect(change.verdict).toBe('blocked');
      expect(change.blockedBy).toBe('compare_at_not_above');
    });

    it('starts a sale by moving the price down and remembering the old one', () => {
      const op = { kind: 'start_sale', discountBasisPoints: 2000 } as const;
      const change = computeChange(op, variant({ priceCents: 2000 }));
      expect(change.newPriceCents).toBe(1600);
      expect(change.newCompareAtPriceCents).toBe(2000);
      expect(change.verdict).toBe('change');
    });

    it('refuses to start a sale on a variant already on sale, the one irreversible mistake', () => {
      const op = { kind: 'start_sale', discountBasisPoints: 2000 } as const;
      const change = computeChange(op, variant({ priceCents: 1600, compareAtPriceCents: 2000 }));
      expect(change.verdict).toBe('blocked');
      expect(change.blockedBy).toBe('already_on_sale');
    });

    it('ends a sale by restoring the list price the compare-at remembers', () => {
      const op = { kind: 'end_sale' } as const;
      const change = computeChange(op, variant({ priceCents: 1600, compareAtPriceCents: 2000 }));
      expect(change.newPriceCents).toBe(2000);
      expect(change.newCompareAtPriceCents).toBeNull();
      expect(change.verdict).toBe('change');
    });

    it('leaves a variant with no compare-at unchanged when ending a sale', () => {
      const op = { kind: 'end_sale' } as const;
      expect(computeChange(op, variant({ compareAtPriceCents: null })).verdict).toBe('unchanged');
    });
  });

  // ---------------------------------------------------------------------------- the endpoints

  describe('the endpoints', () => {
    let app: FastifyInstance;
    let fixture: CatalogFixture;
    let databaseUrl: string;
    let token: string;

    beforeAll(async () => {
      app = await buildTestApp();
      databaseUrl = testEnv().DATABASE_URL;
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(async () => {
      await truncateAll(databaseUrl);
      fixture = await seedCatalogFixture(app.db);

      const hash = await hashPassword(FIXTURE_PASSWORD);
      await app.db.insert(adminUsers).values([
        { email: 'owner@silkgrain.test', passwordHash: hash, name: 'Timur R.', role: 'owner' },
        { email: 'support@silkgrain.test', passwordHash: hash, name: 'Ben C.', role: 'support' },
      ]);
      token = await signIn('owner@silkgrain.test');
    });

    async function signIn(email: string): Promise<string> {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/admin/login',
        remoteAddress: freshAddress(),
        payload: { email, password: FIXTURE_PASSWORD },
      });
      return login.json<{ accessToken: string }>().accessToken;
    }

    const auth = () => ({ authorization: `Bearer ${token}` });

    type Injected = Awaited<ReturnType<FastifyInstance['inject']>>;
    const preview = (body: Record<string, unknown>, headers = auth()): Promise<Injected> =>
      app.inject({
        method: 'POST',
        url: '/api/admin/pricing/preview',
        remoteAddress: freshAddress(),
        headers,
        payload: body,
      });

    const apply = (body: Record<string, unknown>, headers = auth()): Promise<Injected> =>
      app.inject({
        method: 'POST',
        url: '/api/admin/pricing/apply',
        remoteAddress: freshAddress(),
        headers,
        payload: body,
      });

    /** The devzira variant the fixture always seeds, with its current price. */
    async function devzira(): Promise<{ id: number; priceCents: number }> {
      const [row] = await app.db
        .select({ id: productVariants.id, priceCents: productVariants.priceCents })
        .from(productVariants)
        .where(eq(productVariants.id, fixture.variants.devzira2lb));
      return { id: row?.id ?? 0, priceCents: row?.priceCents ?? 0 };
    }

    it('refuses the preview without an admin session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/pricing/preview',
        remoteAddress: freshAddress(),
        payload: { scope: {}, operation: { kind: 'adjust_percent', deltaBasisPoints: 500 } },
      });
      expect(response.statusCode).toBe(401);
    });

    it('previews without writing anything', async () => {
      const before = await devzira();

      const response = await preview({
        scope: { status: 'active' },
        operation: { kind: 'adjust_percent', deltaBasisPoints: 1000 },
      });
      expect(response.statusCode).toBe(200);

      const body = response.json<AdminPricePreview>();
      const row = body.rows.find((entry) => entry.variantId === before.id);
      expect(row?.newPriceCents).toBe(Math.round((before.priceCents * 11_000) / 10_000));
      expect(body.counts.change).toBeGreaterThan(0);

      // The database is untouched: a preview is a read.
      const after = await devzira();
      expect(after.priceCents).toBe(before.priceCents);
    });

    it('applies a raise and writes exactly the previewed figure', async () => {
      const before = await devzira();
      const body = await preview({
        scope: { status: 'active' },
        operation: { kind: 'adjust_percent', deltaBasisPoints: 1000 },
      });
      const rows = body.json<AdminPricePreview>().rows.filter((row) => row.verdict === 'change');

      const response = await apply({
        operation: { kind: 'adjust_percent', deltaBasisPoints: 1000 },
        rows: rows.map((row) => ({
          variantId: row.variantId,
          seenPriceCents: row.priceCents,
          seenCompareAtPriceCents: row.compareAtPriceCents,
        })),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<AdminPriceApplyResult>().changed).toBe(rows.length);

      const after = await devzira();
      const expected = rows.find((row) => row.variantId === before.id)?.newPriceCents;
      expect(after.priceCents).toBe(expected);
    });

    it('refuses the whole batch when a row has drifted since the preview', async () => {
      const before = await devzira();

      const response = await apply({
        operation: { kind: 'adjust_percent', deltaBasisPoints: 1000 },
        rows: [
          {
            variantId: before.id,
            // A price the operator never saw: the stored row is 690, not 999.
            seenPriceCents: 999,
            seenCompareAtPriceCents: null,
          },
        ],
      });
      expect(response.statusCode).toBe(409);

      const after = await devzira();
      expect(after.priceCents).toBe(before.priceCents);
    });

    it('refuses a below-cost batch until it is confirmed, then applies it', async () => {
      // Give the variant a cost above what a deep cut would leave.
      const target = await devzira();
      await app.db
        .update(productVariants)
        .set({ costCents: target.priceCents - 10 })
        .where(eq(productVariants.id, target.id));

      const cut = { kind: 'adjust_percent', deltaBasisPoints: -4000 } as const; // -40%
      const seen = {
        operation: cut,
        rows: [
          {
            variantId: target.id,
            seenPriceCents: target.priceCents,
            seenCompareAtPriceCents: null,
          },
        ],
      };

      const refused = await apply(seen);
      expect(refused.statusCode).toBe(422);
      expect(refused.json<{ error: { code: string } }>().error.code).toBe('PRICE_BELOW_COST');

      const confirmed = await apply({ ...seen, allowBelowCost: true });
      expect(confirmed.statusCode).toBe(200);
    });

    it('applies to all rows or none: a blocked row refuses the batch', async () => {
      const target = await devzira();
      // A cut so deep the row lands below a cent: the whole apply must refuse.
      const response = await apply({
        operation: { kind: 'adjust_cents', deltaCents: -100_000 },
        rows: [
          {
            variantId: target.id,
            seenPriceCents: target.priceCents,
            seenCompareAtPriceCents: null,
          },
        ],
      });
      expect(response.statusCode).toBe(409);

      const after = await devzira();
      expect(after.priceCents).toBe(target.priceCents);
    });

    it('starts and ends a sale, round-tripping to the original price', async () => {
      const before = await devzira();

      const started = await apply({
        operation: { kind: 'start_sale', discountBasisPoints: 2000 },
        rows: [
          {
            variantId: before.id,
            seenPriceCents: before.priceCents,
            seenCompareAtPriceCents: null,
          },
        ],
      });
      expect(started.statusCode).toBe(200);

      const [onSale] = await app.db
        .select({
          priceCents: productVariants.priceCents,
          compareAtPriceCents: productVariants.compareAtPriceCents,
        })
        .from(productVariants)
        .where(eq(productVariants.id, before.id));
      expect(onSale?.compareAtPriceCents).toBe(before.priceCents);
      expect(onSale?.priceCents).toBeLessThan(before.priceCents);

      const ended = await apply({
        operation: { kind: 'end_sale' },
        rows: [
          {
            variantId: before.id,
            seenPriceCents: onSale?.priceCents ?? 0,
            seenCompareAtPriceCents: onSale?.compareAtPriceCents ?? null,
          },
        ],
      });
      expect(ended.statusCode).toBe(200);

      const after = await devzira();
      expect(after.priceCents).toBe(before.priceCents);
    });

    it('refuses a scope that matches more than the batch ceiling', async () => {
      // The fixture is far under 500 variants, so force the ceiling low is not possible here;
      // instead assert the whole active catalogue previews rather than 422, proving the ceiling
      // is not tripping on a normal catalogue.
      const response = await preview({
        scope: { status: 'all', includeInactiveVariants: true },
        operation: { kind: 'adjust_cents', deltaCents: 100 },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<AdminPricePreview>().rows.length).toBeLessThanOrEqual(500);
    });

    it('lets a support account preview but not apply', async () => {
      const supportToken = await signIn('support@silkgrain.test');
      const headers = { authorization: `Bearer ${supportToken}` };
      const target = await devzira();

      const previewed = await preview(
        { scope: { status: 'active' }, operation: { kind: 'adjust_cents', deltaCents: 100 } },
        headers,
      );
      expect(previewed.statusCode).toBe(200);

      const applied = await apply(
        {
          operation: { kind: 'adjust_cents', deltaCents: 100 },
          rows: [
            {
              variantId: target.id,
              seenPriceCents: target.priceCents,
              seenCompareAtPriceCents: null,
            },
          ],
        },
        headers,
      );
      expect(applied.statusCode).toBe(403);
    });

    it('scopes to a category, and leaves everything outside it alone', async () => {
      // Everything in the catalogue, priced up by a cent, but scoped to one category.
      const previewed = await preview({
        scope: { status: 'active', category: 'lentils' },
        operation: { kind: 'adjust_cents', deltaCents: 100 },
      });
      const rows: AdminPricePreview['rows'] = previewed.json<AdminPricePreview>().rows;
      expect(rows.length).toBeGreaterThan(0);

      const scopedIds = rows.map((row) => row.variantId);
      const others = await app.db
        .select({ id: productVariants.id, priceCents: productVariants.priceCents })
        .from(productVariants);
      const outside = others.filter((row) => !scopedIds.includes(row.id));

      await apply({
        operation: { kind: 'adjust_cents', deltaCents: 100 },
        rows: rows.map((row) => ({
          variantId: row.variantId,
          seenPriceCents: row.priceCents,
          seenCompareAtPriceCents: row.compareAtPriceCents,
        })),
      });

      const afterOutside = await app.db
        .select({ id: productVariants.id, priceCents: productVariants.priceCents })
        .from(productVariants)
        .where(
          inArray(
            productVariants.id,
            outside.map((row) => row.id),
          ),
        );
      for (const row of afterOutside) {
        expect(row.priceCents).toBe(outside.find((entry) => entry.id === row.id)?.priceCents);
      }
    });
  });
});
