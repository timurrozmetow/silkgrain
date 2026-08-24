import type { AccountSummary, OrderSummary, OrderView } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { customers, orders } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { seedPendingOrder } from '../../test/fixtures/orders';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

describe('reading orders', () => {
  let app: FastifyInstance;
  let fixture: CatalogFixture;
  let databaseUrl: string;

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
  });

  /** Naming the response shape at the call site is the whole point of the parameter. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see above
  async function get<Body>(
    url: string,
    accessToken?: string,
  ): Promise<{ status: number; body: Body }> {
    const response = await app.inject({
      method: 'GET',
      url,
      remoteAddress: freshAddress(),
      ...(accessToken === undefined ? {} : { headers: { authorization: `Bearer ${accessToken}` } }),
    });
    return { status: response.statusCode, body: response.json<Body>() };
  }

  async function signIn(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: freshAddress(),
      payload: { email, password: FIXTURE_PASSWORD },
    });
    return response.json<{ accessToken: string }>().accessToken;
  }

  // ------------------------------------------------------------------------ guest lookup

  it('returns the order to someone who knows the number and the email', async () => {
    const order = await seedPendingOrder(app.db, fixture);

    const { status, body } = await get<OrderView>(
      `/api/orders/${order.orderNumber}?email=${encodeURIComponent(order.email)}`,
    );

    expect(status).toBe(200);
    expect(body.orderNumber).toBe(order.orderNumber);
    expect(body.status).toBe('pending');
    expect(body.totalCents).toBe(order.totalCents);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.sku).toBe('SG-001-2LB');
    expect(body.shippingAddress.city).toBe('Houston');
    expect(body.billingAddress.state).toBe('TX');
    expect(body.payment).toBeNull();
    expect(body.tracking).toBeNull();
  });

  it('accepts the email in any case, as the login does', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const shouted = order.email.toUpperCase();

    expect(
      (await get(`/api/orders/${order.orderNumber}?email=${encodeURIComponent(shouted)}`)).status,
    ).toBe(200);
  });

  /**
   * The property that matters: walking the sequence must not reveal which numbers are real.
   * A wrong email and a number that was never issued have to be indistinguishable.
   */
  it('gives the same answer for the wrong email and for no such order', async () => {
    const order = await seedPendingOrder(app.db, fixture);

    const wrongEmail = await get<{ error: { code: string; message: string } }>(
      `/api/orders/${order.orderNumber}?email=someone.else@example.com`,
    );
    const noSuchOrder = await get<{ error: { code: string; message: string } }>(
      '/api/orders/SG-2026-99998?email=someone.else@example.com',
    );

    expect(wrongEmail.status).toBe(404);
    expect(noSuchOrder.status).toBe(404);
    // `requestId` differs per request by design; everything an attacker could learn from
    // must not.
    expect(wrongEmail.body.error.code).toBe(noSuchOrder.body.error.code);
    expect(wrongEmail.body.error.message).toBe(noSuchOrder.body.error.message);
  });

  it('refuses to look an order up without an email at all', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    expect((await get(`/api/orders/${order.orderNumber}`)).status).toBe(422);
  });

  it('rejects something that is not an order number', async () => {
    expect((await get('/api/orders/12345?email=a@b.test')).status).toBe(422);
  });

  it('never returns the internal note', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    await app.db
      .update(orders)
      .set({ adminNote: 'customer disputed the last one' })
      .where(eq(orders.id, order.id));

    const response = await app.inject({
      method: 'GET',
      url: `/api/orders/${order.orderNumber}?email=${encodeURIComponent(order.email)}`,
      remoteAddress: freshAddress(),
    });

    expect(response.body).not.toContain('disputed');
  });

  it('limits how fast the numbers can be walked', async () => {
    const address = freshAddress();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 22; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/orders/SG-2026-${String(10_000 + attempt)}?email=guess@example.com`,
        remoteAddress: address,
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toContain(429);
  });

  // ----------------------------------------------------------------------- account access

  it('lists the signed-in customer’s orders, newest first', async () => {
    const email = fixture.returningCustomer.email;
    const customerId = fixture.returningCustomer.id;

    await seedPendingOrder(app.db, fixture, {
      orderNumber: 'SG-2026-08001',
      email,
      customerId,
    });
    await seedPendingOrder(app.db, fixture, {
      orderNumber: 'SG-2026-08002',
      email,
      customerId,
      lines: [{ variantId: fixture.variants.saffron8oz, qty: 1, unitPriceCents: 9900 }],
    });

    const token = await signIn(email);
    const { status, body } = await get<{ items: OrderSummary[]; meta: { total: number } }>(
      '/api/account/orders',
      token,
    );

    expect(status).toBe(200);
    // The fixture's own historical order is in here too.
    expect(body.meta.total).toBe(3);
    expect(body.items[0]?.orderNumber).toBe('SG-2026-08002');
    expect(body.items[0]?.itemCount).toBe(1);
    expect(body.items[0]?.imageUrl).toContain('devzira-rice');
  });

  it('does not show one customer another customer’s orders', async () => {
    const stranger = 'stranger@example.com';
    const [row] = await app.db
      .insert(customers)
      .values({
        email: stranger,
        passwordHash: await hashPassword(FIXTURE_PASSWORD),
        firstName: 'Ivan',
        lastName: 'Petrov',
      })
      .$returningId();

    const theirs = await seedPendingOrder(app.db, fixture, {
      orderNumber: 'SG-2026-08010',
      email: fixture.returningCustomer.email,
      customerId: fixture.returningCustomer.id,
    });

    const token = await signIn(stranger);

    const list = await get<{ items: OrderSummary[]; meta: { total: number } }>(
      '/api/account/orders',
      token,
    );
    expect(list.body.meta.total).toBe(0);
    expect(row?.id).toBeGreaterThan(0);

    // And by number, which is the route that would otherwise leak it.
    expect((await get(`/api/account/orders/${theirs.orderNumber}`, token)).status).toBe(404);
  });

  it('returns a customer’s own order by number without asking for the email', async () => {
    const order = await seedPendingOrder(app.db, fixture, {
      orderNumber: 'SG-2026-08020',
      email: fixture.returningCustomer.email,
      customerId: fixture.returningCustomer.id,
    });

    const token = await signIn(fixture.returningCustomer.email);
    const { status, body } = await get<OrderView>(
      `/api/account/orders/${order.orderNumber}`,
      token,
    );

    expect(status).toBe(200);
    expect(body.orderNumber).toBe(order.orderNumber);
  });

  it('refuses every account route without a session', async () => {
    expect((await get('/api/account/orders')).status).toBe(401);
    expect((await get('/api/account/orders/SG-2026-08020')).status).toBe(401);
    expect((await get('/api/account/summary')).status).toBe(401);
  });

  // ------------------------------------------------------------------------- account summary

  it('sums lifetime spend from paid orders only, and counts every order', async () => {
    const email = fixture.returningCustomer.email;
    const customerId = fixture.returningCustomer.id;

    // A second paid order, on top of the fixture's historical one (paid, 5736 cents).
    const paid = await seedPendingOrder(app.db, fixture, {
      orderNumber: 'SG-2026-08100',
      email,
      customerId,
    });
    await app.db.update(orders).set({ status: 'paid' }).where(eq(orders.id, paid.id));

    // A pending order counts as an order, but not a cent of it has been taken.
    await seedPendingOrder(app.db, fixture, {
      orderNumber: 'SG-2026-08101',
      email,
      customerId,
    });

    // A refunded order was paid once, but the money went back, so it is not "spent".
    const refunded = await seedPendingOrder(app.db, fixture, {
      orderNumber: 'SG-2026-08102',
      email,
      customerId,
    });
    await app.db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, refunded.id));

    const token = await signIn(email);
    const { status, body } = await get<AccountSummary>('/api/account/summary', token);

    expect(status).toBe(200);
    // The fixture's historical order plus the three seeded here.
    expect(body.orderCount).toBe(4);
    // Only the two paid ones: 5736 from the fixture and this order's own total.
    expect(body.lifetimeSpentCents).toBe(5736 + paid.totalCents);
    expect(body.currency).toBe('USD');
  });

  it('reads zero for a customer who has never ordered', async () => {
    const newcomer = 'newcomer@example.com';
    await app.db.insert(customers).values({
      email: newcomer,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      firstName: 'Aziza',
      lastName: 'Karimova',
    });

    const token = await signIn(newcomer);
    const { status, body } = await get<AccountSummary>('/api/account/summary', token);

    expect(status).toBe(200);
    expect(body.orderCount).toBe(0);
    expect(body.lifetimeSpentCents).toBe(0);
  });
});
