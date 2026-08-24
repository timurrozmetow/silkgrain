import type { AdminDashboard } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, customers, orders, productVariants } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { seedPendingOrder } from '../../test/fixtures/orders';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * The dashboard's figures.
 *
 * The property worth guarding hardest is that "revenue" here means the same thing it means on the
 * customer's own lifetime-spend card: money taken and kept. Two definitions of a sale in one
 * codebase is how a shop ends up with two different answers to "how much did we make".
 */
describe('the admin dashboard', () => {
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

  async function signInAsAdmin(role: 'owner' | 'manager' | 'support' = 'owner'): Promise<string> {
    const email = `${role}@silkgrain.test`;
    await app.db.insert(adminUsers).values({
      email,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      name: 'Sevara A.',
      role,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email, password: FIXTURE_PASSWORD },
    });
    return response.json<{ accessToken: string }>().accessToken;
  }

  const get = async (token?: string) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
      remoteAddress: freshAddress(),
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    });
    return { status: response.statusCode, body: response.json<AdminDashboard>() };
  };

  it('refuses a request with no session, and a customer’s token', async () => {
    expect((await get()).status).toBe(401);

    const customerLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: freshAddress(),
      payload: { email: fixture.returningCustomer.email, password: FIXTURE_PASSWORD },
    });
    const customerToken = customerLogin.json<{ accessToken: string }>().accessToken;

    // The contours are separate: a valid customer token is not a weak admin token.
    expect((await get(customerToken)).status).toBe(401);
  });

  it('is readable by every admin role', async () => {
    for (const role of ['owner', 'manager', 'support'] as const) {
      await truncateAll(databaseUrl);
      fixture = await seedCatalogFixture(app.db);
      const token = await signInAsAdmin(role);
      expect((await get(token)).status).toBe(200);
    }
  });

  it('counts only orders whose money was taken and kept', async () => {
    const paid = await seedPendingOrder(app.db, fixture, { orderNumber: 'SG-2026-07001' });
    await app.db.update(orders).set({ status: 'paid' }).where(eq(orders.id, paid.id));

    const shipped = await seedPendingOrder(app.db, fixture, { orderNumber: 'SG-2026-07002' });
    await app.db.update(orders).set({ status: 'shipped' }).where(eq(orders.id, shipped.id));

    // None of these three is revenue: not charged, never charged, charged and returned.
    await seedPendingOrder(app.db, fixture, { orderNumber: 'SG-2026-07003' });
    const cancelled = await seedPendingOrder(app.db, fixture, { orderNumber: 'SG-2026-07004' });
    await app.db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, cancelled.id));
    const refunded = await seedPendingOrder(app.db, fixture, { orderNumber: 'SG-2026-07005' });
    await app.db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, refunded.id));

    const token = await signInAsAdmin();
    const { body } = await get(token);

    // The fixture's own historical order is paid, so it counts too.
    expect(body.revenueCents.current).toBe(5736 + paid.totalCents + shipped.totalCents);
    expect(body.orderCount.current).toBe(3);
    expect(body.averageOrderCents.current).toBe(
      Math.round((5736 + paid.totalCents + shipped.totalCents) / 3),
    );
  });

  it('reads a delta of null rather than zero when there is nothing to compare against', async () => {
    const token = await signInAsAdmin();
    const { body } = await get(token);

    // Nothing in the previous window: a first month is not "up 0%".
    expect(body.revenueCents.previous).toBe(0);
    expect(body.revenueCents.deltaBasisPoints).toBeNull();
  });

  it('computes a delta in basis points when both windows have figures', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const older = await seedPendingOrder(app.db, fixture, { orderNumber: 'SG-2026-07010' });
    await app.db
      .update(orders)
      // 40 days ago: inside the previous window, outside the current one.
      .set({ status: 'paid', createdAt: new Date(now - 40 * day) })
      .where(eq(orders.id, older.id));

    const recent = await seedPendingOrder(app.db, fixture, { orderNumber: 'SG-2026-07011' });
    await app.db
      .update(orders)
      .set({ status: 'paid', createdAt: new Date(now - 2 * day) })
      .where(eq(orders.id, recent.id));

    // The fixture's historical order would muddle the arithmetic; drop it for this one case.
    await app.db.delete(orders).where(eq(orders.orderNumber, 'SG-2026-00001'));

    const token = await signInAsAdmin();
    const { body } = await get(token);

    expect(body.revenueCents.current).toBe(recent.totalCents);
    expect(body.revenueCents.previous).toBe(older.totalCents);
    expect(body.revenueCents.deltaBasisPoints).toBe(0);
    expect(body.orderCount.deltaBasisPoints).toBe(0);
  });

  it('fills days with no sales rather than leaving gaps in the chart', async () => {
    const token = await signInAsAdmin();
    const { body } = await get(token);

    // Thirty days plus today. A GROUP BY returns only the days with rows, and a chart drawn from
    // those alone invents a straight line across the quiet ones.
    expect(body.revenueSeries).toHaveLength(31);
    expect(body.revenueSeries.every((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date))).toBe(true);
    const dates = body.revenueSeries.map((point) => point.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('lists the emptiest variants first and includes the ones at zero', async () => {
    const token = await signInAsAdmin();
    const { body } = await get(token);

    expect(body.lowStock.length).toBeGreaterThan(0);
    const quantities = body.lowStock.map((row) => row.stockQty);
    expect([...quantities].sort((a, b) => a - b)).toEqual(quantities);
    // Out of stock is the most urgent case, so it must be present rather than filtered away.
    expect(quantities[0]).toBe(0);
    expect(body.lowStock.every((row) => row.stockQty <= row.lowStockThreshold)).toBe(true);
  });

  it('leaves a draft product out of the low-stock panel', async () => {
    const token = await signInAsAdmin();
    const { body } = await get(token);

    // `hidden-draft` has an active, in-stock variant, but nobody can buy it.
    expect(body.lowStock.map((row) => row.productSlug)).not.toContain('hidden-draft');
    const [draftVariant] = await app.db
      .select({ stockQty: productVariants.stockQty })
      .from(productVariants)
      .where(eq(productVariants.id, fixture.variants.draftVariant));
    expect(draftVariant?.stockQty).toBeGreaterThan(0);
  });

  it('names the customer on an order that has one, and nothing on a guest’s', async () => {
    await seedPendingOrder(app.db, fixture, {
      orderNumber: 'SG-2026-07020',
      email: fixture.returningCustomer.email,
      customerId: fixture.returningCustomer.id,
    });
    await seedPendingOrder(app.db, fixture, {
      orderNumber: 'SG-2026-07021',
      email: 'guest@example.com',
      customerId: null,
    });

    const token = await signInAsAdmin();
    const { body } = await get(token);

    const named = body.recentOrders.find((row) => row.orderNumber === 'SG-2026-07020');
    const guest = body.recentOrders.find((row) => row.orderNumber === 'SG-2026-07021');
    expect(named?.customerName).toBeTruthy();
    // Most checkouts are guest checkouts, and a left join is why they still appear at all.
    expect(guest?.customerName).toBeNull();
    expect(guest?.email).toBe('guest@example.com');
    expect(guest?.itemCount).toBeGreaterThan(0);
  });

  it('answers with zeroes rather than failing on an empty shop', async () => {
    await truncateAll(databaseUrl);
    await app.db.insert(customers).values({
      email: 'nobody@example.com',
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      firstName: 'No',
      lastName: 'Body',
    });

    const token = await signInAsAdmin();
    const { status, body } = await get(token);

    expect(status).toBe(200);
    expect(body.revenueCents.current).toBe(0);
    expect(body.averageOrderCents.current).toBe(0);
    expect(body.lowStock).toEqual([]);
    expect(body.recentOrders).toEqual([]);
    expect(body.revenueSeries).toHaveLength(31);
  });
});
