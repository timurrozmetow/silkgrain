import {
  AUDIT_ACTION,
  AUDIT_ACTION_ENTITY,
  AUDIT_ENTITY_TYPE,
  type AdminAuditActors,
  type AdminAuditEntry,
  type AdminAuditResponse,
  type AdminOrderDetail,
  type CheckoutIntentInput,
} from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, auditLog } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';
import { quoteCart } from '../cart/cart.service';
import { createPendingOrder } from '../checkout/checkout.service';

/**
 * The audit log, written from inside the transactions it describes.
 *
 * The entry and the change are one atomic thing: an audit row that can be missing while the change
 * is committed is the exact failure a log exists to prevent. These tests care about three things -
 * that the row lands, that it carries only the fields that moved, and that no projector ever
 * archives a credential.
 */
describe('the audit log', () => {
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

    await app.db.insert(adminUsers).values({
      email: 'ops@silkgrain.test',
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      name: 'Dilnoza R.',
      role: 'manager',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'ops@silkgrain.test', password: FIXTURE_PASSWORD },
    });
    token = login.json<{ accessToken: string }>().accessToken;
  });

  const auth = () => ({ authorization: `Bearer ${token}` });
  const entries = () => app.db.select().from(auditLog).orderBy(auditLog.id);

  async function placeOrder(): Promise<{ id: number; number: string }> {
    const lines = [{ variantId: fixture.variants.devzira2lb, qty: 1 }];
    const quote = await quoteCart(
      app.db,
      { lines, shippingMethod: 'standard' },
      { strictPromo: false, identity: { email: 'buyer@example.com' } },
    );
    const intent: CheckoutIntentInput = {
      email: 'buyer@example.com',
      lines,
      shippingAddress: {
        firstName: 'Nodira',
        lastName: 'Yusupova',
        line1: '5850 San Felipe St',
        city: 'Houston',
        state: 'TX',
        zip: '77057',
        country: 'US',
      },
      shippingMethod: 'standard',
      marketingOptIn: false,
      provider: 'stripe',
      expectedTotalCents: quote.totalCents,
    };
    const created = await createPendingOrder(app.db, intent, {
      customerId: null,
      orderNumberPrefix: 'SG',
    });
    return { id: created.id, number: created.orderNumber };
  }

  it('records who did what, with the authority they did it with', async () => {
    const order = await placeOrder();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/orders/${order.number}/note`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { adminNote: 'Customer asked about the delivery window' },
    });
    expect(response.statusCode).toBe(200);

    const [entry] = await entries();
    expect(entry?.action).toBe('order.note_updated');
    expect(entry?.entityType).toBe('order');
    expect(entry?.entityId).toBe(order.id);
    // Legible on its own: no join needed to learn which order this was.
    expect(entry?.entityLabel).toBe(order.number);
    expect(entry?.actorName).toBe('Dilnoza R.');
    // The authority the action was taken with, not the role the account holds now.
    expect(entry?.actorRole).toBe('manager');
  });

  it('stores only the fields that actually moved', async () => {
    const order = await placeOrder();

    await app.inject({
      method: 'PUT',
      url: `/api/admin/orders/${order.number}/tracking`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { carrier: 'UPS', trackingNumber: '1Z999AA10123456784', trackingUrl: null },
    });

    const [entry] = await entries();
    expect(entry?.action).toBe('order.tracking_updated');
    expect(entry?.before).toEqual({ carrier: null, trackingNumber: null });
    expect(entry?.after).toEqual({ carrier: 'UPS', trackingNumber: '1Z999AA10123456784' });
    // `status`, `adminNote` and every timestamp are unchanged and therefore absent: a diff of one
    // field should read as one field.
    expect(Object.keys(entry?.after ?? {})).toHaveLength(2);
  });

  it('writes nothing when a save changes nothing', async () => {
    const order = await placeOrder();
    const body = { adminNote: 'The same note' };

    for (const attempt of [1, 2]) {
      expect(attempt).toBeGreaterThan(0);

      await app.inject({
        method: 'PUT',
        url: `/api/admin/orders/${order.number}/note`,
        remoteAddress: freshAddress(),
        headers: auth(),
        payload: body,
      });
    }

    // A log that records a no-op is a log that buries the changes that matter.
    expect(await entries()).toHaveLength(1);
  });

  it('keeps the reason beside the change, not only in the note field', async () => {
    const order = await placeOrder();

    await app.inject({
      method: 'PATCH',
      url: `/api/admin/orders/${order.number}/status`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { status: 'cancelled', note: 'Customer changed their mind' },
    });

    const [entry] = await entries();
    expect(entry?.action).toBe('order.status_changed');
    expect(entry?.note).toBe('Customer changed their mind');
    expect(entry?.before).toMatchObject({ status: 'pending' });
    expect(entry?.after).toMatchObject({ status: 'cancelled' });
  });

  it('records the origin of the request, which is what makes a burst answerable', async () => {
    const order = await placeOrder();

    await app.inject({
      method: 'PUT',
      url: `/api/admin/orders/${order.number}/note`,
      remoteAddress: '203.0.113.7',
      headers: { ...auth(), 'user-agent': 'Mozilla/5.0 (SilkGrain admin test)' },
      payload: { adminNote: 'Noted' },
    });

    const [entry] = await entries();
    expect(entry?.ip).toBe('203.0.113.7');
    expect(entry?.userAgent).toContain('SilkGrain admin test');
  });

  it('leaves no entry behind when the change itself is refused', async () => {
    const order = await placeOrder();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/orders/${order.number}/status`,
      remoteAddress: freshAddress(),
      headers: auth(),
      // `pending` cannot become `delivered`; the transaction rolls back.
      payload: { status: 'delivered' },
    });
    expect(response.statusCode).toBe(409);
    expect(await entries()).toHaveLength(0);
  });

  it('never archives a credential', async () => {
    const order = await placeOrder();
    await app.inject({
      method: 'PUT',
      url: `/api/admin/orders/${order.number}/note`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { adminNote: 'Noted' },
    });

    // Every projector is an allow-list of named columns, so a hash has nowhere to land.
    const serialised = JSON.stringify(await entries());
    expect(serialised).not.toContain('$argon2');
    expect(serialised).not.toContain('passwordHash');
  });

  it('names an entity type for every action, and an action for every write', () => {
    // The vocabulary is one-to-one with the audited write routes on purpose: it is what makes the
    // list complete and testable. A new action added without an entity type fails here rather
    // than at the first request that uses it.
    for (const action of AUDIT_ACTION) {
      expect(AUDIT_ACTION_ENTITY[action]).toBeDefined();
      expect(AUDIT_ENTITY_TYPE).toContain(AUDIT_ACTION_ENTITY[action]);
    }
    expect(Object.keys(AUDIT_ACTION_ENTITY)).toHaveLength(AUDIT_ACTION.length);
  });

  it('records a bulk price change as one entry, not one per row', async () => {
    const preview = await app.inject({
      method: 'POST',
      url: '/api/admin/pricing/preview',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: {
        scope: { status: 'active' },
        operation: { kind: 'adjust_cents', deltaCents: 100 },
      },
    });
    expect(preview.statusCode).toBe(200);

    const rows = preview
      .json<{
        rows: { variantId: number; priceCents: number; compareAtPriceCents: number | null }[];
      }>()
      .rows.slice(0, 3)
      .map((row) => ({
        variantId: row.variantId,
        seenPriceCents: row.priceCents,
        seenCompareAtPriceCents: row.compareAtPriceCents,
      }));

    const applied = await app.inject({
      method: 'POST',
      url: '/api/admin/pricing/apply',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { operation: { kind: 'adjust_cents', deltaCents: 100 }, rows },
    });
    expect(applied.statusCode).toBe(200);

    const entries_ = await entries();
    // Three variants moved and one entry describes it: the operator performed one action, and
    // three hundred entries would bury every other change in the log.
    expect(entries_).toHaveLength(1);
    expect(entries_[0]?.action).toBe('pricing.applied');
    expect(entries_[0]?.entityId).toBeNull();
    expect(entries_[0]?.entityLabel).toBe('3 variants');
    // Keyed by SKU, so the entry stays legible after a variant is gone.
    expect(Object.keys(entries_[0]?.after ?? {}).every((key) => key.includes('.'))).toBe(true);
  });

  // ------------------------------------------------------------------------------ reading it

  /** Writes `count` note entries against one order, oldest first. */
  async function writeEntries(count: number): Promise<string> {
    const order = await placeOrder();
    for (let index = 0; index < count; index += 1) {
      await app.inject({
        method: 'PUT',
        url: `/api/admin/orders/${order.number}/note`,
        remoteAddress: freshAddress(),
        headers: auth(),
        payload: { adminNote: `Note ${String(index)}` },
      });
    }
    return order.number;
  }

  it('reads the log newest first, with the fields that moved but not their values', async () => {
    await writeEntries(2);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/audit',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);

    const body = response.json<AdminAuditResponse>();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.id).toBeGreaterThan(body.items[1]?.id ?? 0);
    expect(body.items[0]?.changedFields).toEqual(['adminNote']);
    expect(body.items[0]?.actorRole).toBe('manager');
    // The values, the ip and the user agent belong to the detail: a page of fifty entries each
    // hauling a full payload is a slow screen nobody reads.
    expect(response.body).not.toContain('Note 1');
    expect(response.body).not.toContain('userAgent');
  });

  it('walks pages by cursor and stops when there are none left', async () => {
    await writeEntries(5);

    const first = await app.inject({
      method: 'GET',
      url: '/api/admin/audit?limit=2',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    const page1 = first.json<AdminAuditResponse>();
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/api/admin/audit?limit=2&before=${String(page1.nextCursor)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    const page2 = second.json<AdminAuditResponse>();
    expect(page2.items).toHaveLength(2);
    // No overlap: the cursor is the last id of the previous page and the filter is strictly less.
    const seen = new Set(page1.items.map((item) => item.id));
    expect(page2.items.every((item) => !seen.has(item.id))).toBe(true);

    const third = await app.inject({
      method: 'GET',
      url: `/api/admin/audit?limit=2&before=${String(page2.nextCursor)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    const page3 = third.json<AdminAuditResponse>();
    expect(page3.items).toHaveLength(1);
    // The last page says so rather than making the client ask again to find out.
    expect(page3.nextCursor).toBeNull();
  });

  it('serves the values, the origin and the diff only on the detail', async () => {
    await writeEntries(1);
    const [row] = await entries();

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/audit/${String(row?.id ?? 0)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);

    const entry = response.json<AdminAuditEntry>();
    expect(entry.after).toEqual({ adminNote: 'Note 0' });
    expect(entry.ip).not.toBeNull();
    expect(entry.userAgent).toBeDefined();
  });

  it('filters to one entity, and refuses an id without the type it belongs to', async () => {
    const number = await writeEntries(1);
    const [row] = await entries();

    const scoped = await app.inject({
      method: 'GET',
      url: `/api/admin/audit?entityType=order&entityId=${String(row?.entityId ?? 0)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(scoped.json<AdminAuditResponse>().items).toHaveLength(1);
    expect(scoped.json<AdminAuditResponse>().items[0]?.entityLabel).toBe(number);

    // Ids are only unique within a type: product 41 and order 41 are different rows, and
    // answering with both would be a coincidence presented as a result.
    const loose = await app.inject({
      method: 'GET',
      url: '/api/admin/audit?entityId=1',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(loose.statusCode).toBe(422);
  });

  it('lists who appears in the log, counted', async () => {
    await writeEntries(3);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/audit/actors',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);

    const { actors } = response.json<AdminAuditActors>();
    expect(actors).toHaveLength(1);
    expect(actors[0]?.name).toBe('Dilnoza R.');
    expect(actors[0]?.entryCount).toBe(3);
  });

  it('keeps the log away from support entirely', async () => {
    await app.db.insert(adminUsers).values({
      email: 'desk@silkgrain.test',
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      name: 'Ben C.',
      role: 'support',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'desk@silkgrain.test', password: FIXTURE_PASSWORD },
    });
    const supportToken = login.json<{ accessToken: string }>().accessToken;

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/audit',
      remoteAddress: freshAddress(),
      headers: { authorization: `Bearer ${supportToken}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('commits the change and the entry as one atomic thing', async () => {
    const order = await placeOrder();
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/orders/${order.number}/status`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { status: 'cancelled' },
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/api/admin/orders/${order.number}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(detail.json<AdminOrderDetail>().status).toBe('cancelled');

    const rows = await app.db.select().from(auditLog).where(eq(auditLog.entityId, order.id));
    // The write went inside the caller's transaction, so there is no window in which one exists
    // without the other.
    expect(rows).toHaveLength(1);
  });
});
