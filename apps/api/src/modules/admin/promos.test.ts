import type { AdminPromoDetail, AdminPromoListResponse, PromoState } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, orders, promoCodes, promoRedemptions } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';
import { evaluatePromo } from '../cart/promo.service';

/**
 * Promo codes in the back office.
 *
 * The reads matter less than two specific risks. The derived state is expressed twice - once as a
 * projection and once as a SQL filter - and the classic failure is the two drifting so that a
 * filter for `live` returns a row the same response chips `exhausted`; there is a round-trip test
 * for every state, and another that asks the cart's own evaluator whether it agrees. And the write
 * path guards two things a careless panel destroys: `used_count`, which is an accounting fact, and
 * the code string, which `orders.promo_code` snapshots and the paid transaction looks up by.
 */
describe('admin promos', () => {
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
  const get = (url: string) =>
    app.inject({ method: 'GET', url, remoteAddress: freshAddress(), headers: auth() });

  const PERCENT = {
    code: 'SPRING10',
    description: 'Ten per cent off',
    discount: { type: 'percent', basisPoints: 1000, maxDiscountCents: 5000 },
    minOrderCents: 0,
    usageLimit: null,
    usageLimitPerCustomer: null,
    startsAt: null,
    endsAt: null,
    isActive: true,
  };

  const create = (over: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/admin/promos',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { ...PERCENT, ...over },
    });

  /** A row written straight to the table, for states a create cannot produce. */
  async function seedCode(over: Partial<typeof promoCodes.$inferInsert>): Promise<number> {
    const code = typeof over.code === 'string' ? over.code : 'SEEDED';
    await app.db.insert(promoCodes).values({
      code,
      type: 'fixed',
      value: 500,
      minOrderCents: 0,
      ...over,
    });
    const [row] = await app.db
      .select({ id: promoCodes.id })
      .from(promoCodes)
      .where(eq(promoCodes.code, code));
    return row?.id ?? 0;
  }

  it('refuses the list without an admin session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/promos',
      remoteAddress: freshAddress(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('creates a percentage code and reads its discount back in basis points', async () => {
    const response = await create();
    expect(response.statusCode).toBe(201);

    const detail = response.json<AdminPromoDetail>();
    expect(detail.code).toBe('SPRING10');
    expect(detail.discount).toEqual({
      type: 'percent',
      basisPoints: 1000,
      maxDiscountCents: 5000,
    });
    expect(detail.state).toBe('live');
    expect(detail.usedCount).toBe(0);
  });

  it('upper-cases a code on the way in, so two cases are not two campaigns', async () => {
    const detail = (await create({ code: 'spring20' })).json<AdminPromoDetail>();
    expect(detail.code).toBe('SPRING20');
  });

  it('refuses a fixed code carrying a cap, because discountFor would apply it', async () => {
    // A $20 code capped at $5 has the panel printing $20 and the cart taking off $5. The union
    // makes it unrepresentable; this proves the request is refused rather than silently trimmed.
    const response = await create({
      code: 'FIXEDCAP',
      discount: { type: 'fixed', amountCents: 2000, maxDiscountCents: 500 },
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses a percentage above one hundred per cent', async () => {
    const response = await create({
      code: 'TOOMUCH',
      discount: { type: 'percent', basisPoints: 50_000, maxDiscountCents: null },
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses a cap of nothing, which is a code that takes nothing off', async () => {
    const response = await create({
      code: 'ZEROCAP',
      discount: { type: 'percent', basisPoints: 1000, maxDiscountCents: 0 },
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses a window that ends before it starts, before MySQL does', async () => {
    const response = await create({
      code: 'BACKWARDS',
      startsAt: '2026-06-01T00:00:00.000Z',
      endsAt: '2026-05-01T00:00:00.000Z',
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses a per-customer limit that can never bind', async () => {
    const response = await create({
      code: 'NEVERBIND',
      usageLimit: 5,
      usageLimitPerCustomer: 10,
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses a usage limit of zero, which means "off" obscurely', async () => {
    const response = await create({ code: 'ZEROLIMIT', usageLimit: 0 });
    expect(response.statusCode).toBe(422);
  });

  it('refuses a duplicate code with a 409 rather than a unique-index 500', async () => {
    await create();
    const response = await create({ description: 'Another go' });
    expect(response.statusCode).toBe(409);
  });

  it('will not accept usedCount from a client, at create or update', async () => {
    const created = await create({ usedCount: 99 });
    expect(created.statusCode).toBe(422);

    const id = await seedCode({ code: 'COUNTER', usedCount: 3 });
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/admin/promos/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: {
        code: 'COUNTER',
        description: null,
        discount: { type: 'fixed', amountCents: 500 },
        minOrderCents: 0,
        usageLimit: null,
        usageLimitPerCustomer: null,
        startsAt: null,
        endsAt: null,
        usedCount: 0,
      },
    });
    expect(updated.statusCode).toBe(422);

    const [row] = await app.db.select().from(promoCodes).where(eq(promoCodes.id, id));
    expect(row?.usedCount).toBe(3);
  });

  it('does not let a stale edit form revert the kill switch', async () => {
    const id = (await create()).json<AdminPromoDetail>().id;
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/promos/${String(id)}/active`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { isActive: false },
    });

    // A form opened before the switch was thrown would carry isActive: true. The body refuses it.
    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/promos/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { ...PERCENT, isActive: true },
    });
    expect(response.statusCode).toBe(422);

    const [row] = await app.db.select().from(promoCodes).where(eq(promoCodes.id, id));
    expect(row?.isActive).toBe(false);
  });

  it('switches a code off, which is the terminal action', async () => {
    const id = (await create()).json<AdminPromoDetail>().id;

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/promos/${String(id)}/active`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { isActive: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<AdminPromoDetail>().state).toBe('disabled');
  });

  it('offers no way to delete a code at all', async () => {
    const id = (await create()).json<AdminPromoDetail>().id;
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/admin/promos/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    // promo_redemptions cascades from this row; there is no route to destroy it.
    expect(response.statusCode).toBe(404);
  });

  // ------------------------------------------------------------------------------- renaming

  /** An order that named a code, at a status of our choosing. */
  async function orderNaming(code: string, status: 'pending' | 'paid'): Promise<void> {
    await app.db.insert(orders).values({
      orderNumber: `SG-2026-6${String(Math.floor(code.length * 111)).padStart(4, '0')}`,
      email: 'buyer@example.com',
      status,
      subtotalCents: 5000,
      totalCents: 5000,
      shippingMethod: 'standard',
      promoCode: code,
    });
  }

  const renamePayload = (code: string) => ({
    code,
    description: null,
    discount: { type: 'fixed', amountCents: 500 },
    minOrderCents: 0,
    usageLimit: null,
    usageLimitPerCustomer: null,
    startsAt: null,
    endsAt: null,
  });

  it('renames a code nobody has used', async () => {
    const id = await seedCode({ code: 'TYPOO' });

    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/promos/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: renamePayload('TYPO'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<AdminPromoDetail>().code).toBe('TYPO');
  });

  it('refuses to rename a code a pending order has already quoted', async () => {
    // The dangerous case: used_count and promo_redemptions both read zero here, because both are
    // written by the paid transaction. A guard on either would let this rename through, and the
    // webhook would then find no row and record no redemption.
    const id = await seedCode({ code: 'INFLIGHT' });
    await orderNaming('INFLIGHT', 'pending');

    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/promos/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: renamePayload('RENAMED'),
    });
    expect(response.statusCode).toBe(409);

    const [row] = await app.db.select().from(promoCodes).where(eq(promoCodes.id, id));
    expect(row?.code).toBe('INFLIGHT');
  });

  it('still lets the other fields change on a code that cannot be renamed', async () => {
    const id = await seedCode({ code: 'LOCKED' });
    await orderNaming('LOCKED', 'paid');

    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/promos/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { ...renamePayload('LOCKED'), minOrderCents: 2500 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<AdminPromoDetail>().minOrderCents).toBe(2500);
    expect(response.json<AdminPromoDetail>().canRenameCode).toBe(false);
  });

  it('reports whether the code can still be renamed', async () => {
    const free = await seedCode({ code: 'FREENAME' });
    expect(
      (await get(`/api/admin/promos/${String(free)}`)).json<AdminPromoDetail>().canRenameCode,
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------- derived state

  /** One code per state, all five, written directly. */
  async function seedEveryState(): Promise<Record<PromoState, string>> {
    const hour = 60 * 60 * 1000;
    await seedCode({ code: 'STDISABLED', isActive: false });
    await seedCode({ code: 'STSCHEDULED', startsAt: new Date(Date.now() + hour) });
    await seedCode({
      code: 'STEXPIRED',
      startsAt: new Date(Date.now() - 2 * hour),
      endsAt: new Date(Date.now() - hour),
    });
    await seedCode({ code: 'STEXHAUSTED', usageLimit: 2, usedCount: 2 });
    await seedCode({ code: 'STLIVE' });

    return {
      disabled: 'STDISABLED',
      scheduled: 'STSCHEDULED',
      expired: 'STEXPIRED',
      exhausted: 'STEXHAUSTED',
      live: 'STLIVE',
    };
  }

  it('chips every code with the state it is in', async () => {
    const codes = await seedEveryState();
    const body = (await get('/api/admin/promos?perPage=100')).json<AdminPromoListResponse>();

    for (const [state, code] of Object.entries(codes)) {
      expect(body.items.find((item) => item.code === code)?.state).toBe(state);
    }
  });

  it('filters by state without the filter and the chip disagreeing', async () => {
    const codes = await seedEveryState();

    for (const [state, code] of Object.entries(codes)) {
      const body = (
        await get(`/api/admin/promos?state=${state}&perPage=100`)
      ).json<AdminPromoListResponse>();

      expect(body.items.map((item) => item.code)).toContain(code);
      // The round trip that catches the drift: every row a filter returns must carry its chip.
      expect(body.items.every((item) => item.state === state)).toBe(true);
    }
  });

  it('agrees with the cart’s own evaluator about which codes are usable', async () => {
    const codes = await seedEveryState();
    const { Money } = await import('@silkgrain/contracts/money');
    const subtotal = Money.fromCents(10_000);

    for (const [state, code] of Object.entries(codes)) {
      const outcome = await evaluatePromo(app.db, code, subtotal, {}, true).then(
        () => 'accepted',
        () => 'rejected',
      );
      expect(outcome).toBe(state === 'live' ? 'accepted' : 'rejected');
    }
  });

  // ------------------------------------------------------------------------------ redemptions

  it('lists what a code has actually taken off, and says nothing it cannot', async () => {
    const id = await seedCode({ code: 'REDEEMED', usedCount: 1 });
    await app.db.insert(orders).values({
      orderNumber: 'SG-2026-61234',
      email: 'buyer@example.com',
      status: 'paid',
      subtotalCents: 5000,
      totalCents: 4500,
      shippingMethod: 'standard',
      promoCode: 'REDEEMED',
      promoDiscountCents: 500,
    });
    const [order] = await app.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, 'SG-2026-61234'));
    await app.db.insert(promoRedemptions).values({
      promoCodeId: id,
      orderId: order?.id ?? 0,
      email: 'buyer@example.com',
      discountCents: 500,
    });

    const detail = (await get(`/api/admin/promos/${String(id)}`)).json<AdminPromoDetail>();
    expect(detail.redemptionCount).toBe(1);
    expect(detail.redemptions[0]).toMatchObject({
      orderNumber: 'SG-2026-61234',
      email: 'buyer@example.com',
      recordedDiscountCents: 500,
    });
  });

  it('lets a support account read codes but not write them', async () => {
    const id = (await create()).json<AdminPromoDetail>().id;
    const supportToken = await signIn('support@silkgrain.test');
    const headers = { authorization: `Bearer ${supportToken}` };

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/admin/promos',
          remoteAddress: freshAddress(),
          headers,
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/admin/promos/${String(id)}/active`,
          remoteAddress: freshAddress(),
          headers,
          payload: { isActive: false },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('is a 404 for a code that does not exist', async () => {
    expect((await get('/api/admin/promos/99999')).statusCode).toBe(404);
    expect(fixture.productIds['devzira-rice']).toBeGreaterThan(0);
  });
});
