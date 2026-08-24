import type { AdminCustomerDetail, AdminCustomerListResponse } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, customers, orders, refreshTokens } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import { FIXTURE_PASSWORD, seedCatalogFixture } from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * Customers in the back office.
 *
 * The reads are worth a few tests - the aggregates are a subquery join and those go wrong quietly.
 * The write is worth most of them, because "block this person" is a claim about what they can still
 * do, and until this task the claim would have been false: the customer refresh route never
 * re-read `status`, so a blocked account kept minting access tokens for the thirty-day life of its
 * refresh family. The tests below are what make the Block button honest rather than decorative.
 */
describe('admin customers', () => {
  let app: FastifyInstance;
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
    await seedCatalogFixture(app.db);

    await app.db.insert(adminUsers).values({
      email: 'owner@silkgrain.test',
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      name: 'Timur R.',
      role: 'owner',
    });
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

  /** A registered customer, through the real registration route so the row is shaped as it is. */
  async function register(email: string, firstName = 'Nodira'): Promise<{ id: number }> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: freshAddress(),
      payload: {
        email,
        password: 'Silk-Grain-2026',
        firstName,
        lastName: 'Yusupova',
        marketingOptIn: false,
      },
    });
    expect(response.statusCode).toBe(201);

    const [row] = await app.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, email));
    return { id: row?.id ?? 0 };
  }

  /** An order for that customer in a status of our choosing, written straight to the table. */
  async function giveOrder(customerId: number, email: string, status: string, totalCents: number) {
    await app.db.insert(orders).values({
      orderNumber: `SG-2026-${String(90000 + Math.floor(totalCents % 9000)).padStart(5, '0')}`,
      email,
      customerId,
      status: status as 'paid',
      subtotalCents: totalCents,
      totalCents,
      shippingMethod: 'standard',
    });
  }

  it('refuses the list without an admin session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/customers',
      remoteAddress: freshAddress(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('lists account holders with their name joined once, on the server', async () => {
    await register('nodira@example.com');

    const body = (await get('/api/admin/customers')).json<AdminCustomerListResponse>();
    const row = body.items.find((item) => item.email === 'nodira@example.com');
    expect(row?.name).toBe('Nodira Yusupova');
    expect(row?.status).toBe('active');
    expect(row?.orderCount).toBe(0);
    expect(row?.lifetimeSpentCents).toBe(0);
    expect(row?.lastOrderAt).toBeNull();
  });

  it('counts every order but only banks the four statuses that mean money stayed', async () => {
    const { id } = await register('spender@example.com');
    await giveOrder(id, 'spender@example.com', 'paid', 5000);
    await giveOrder(id, 'spender@example.com', 'delivered', 2500);
    // Cancelled and pending are orders that happened and money that did not.
    await giveOrder(id, 'spender@example.com', 'cancelled', 9900);
    await giveOrder(id, 'spender@example.com', 'pending', 1100);

    const body = (await get('/api/admin/customers?q=spender')).json<AdminCustomerListResponse>();
    const row = body.items[0];
    expect(row?.orderCount).toBe(4);
    expect(row?.lifetimeSpentCents).toBe(7500);
  });

  it('agrees to the cent with the customer’s own account card', async () => {
    const { id } = await register('agrees@example.com');
    await giveOrder(id, 'agrees@example.com', 'shipped', 3300);
    await giveOrder(id, 'agrees@example.com', 'refunded', 4400);

    const admin = (await get(`/api/admin/customers/${String(id)}`)).json<AdminCustomerDetail>();

    const session = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: freshAddress(),
      payload: { email: 'agrees@example.com', password: 'Silk-Grain-2026' },
    });
    const customerToken = session.json<{ accessToken: string }>().accessToken;
    const account = await app.inject({
      method: 'GET',
      url: '/api/account/summary',
      remoteAddress: freshAddress(),
      headers: { authorization: `Bearer ${customerToken}` },
    });

    expect(account.statusCode).toBe(200);
    const card = account.json<{ lifetimeSpentCents: number; orderCount: number }>();
    // One definition of "money taken and kept", now in contracts, read by both.
    expect(admin.lifetimeSpentCents).toBe(card.lifetimeSpentCents);
    expect(admin.orderCount).toBe(card.orderCount);
  });

  it('does not invent a customer out of guest orders', async () => {
    // A guest order carries an email and no customer_id. Grouping by email to manufacture a row
    // would assert an identity the checkout declines to assert.
    await app.db.insert(orders).values({
      orderNumber: 'SG-2026-70001',
      email: 'guest@example.com',
      customerId: null,
      status: 'paid',
      subtotalCents: 1000,
      totalCents: 1000,
      shippingMethod: 'standard',
    });

    const body = (await get('/api/admin/customers?q=guest')).json<AdminCustomerListResponse>();
    expect(body.items).toHaveLength(0);
  });

  it('sorts by spend, with people who never ordered last rather than first', async () => {
    const big = await register('big@example.com', 'Big');
    const small = await register('small@example.com', 'Small');
    await register('never@example.com', 'Never');
    await giveOrder(big.id, 'big@example.com', 'paid', 8000);
    await giveOrder(small.id, 'small@example.com', 'paid', 1200);

    const body = (await get('/api/admin/customers?sort=spend')).json<AdminCustomerListResponse>();
    // Relative order of the three this test made: the catalogue fixture seeds a returning
    // customer of its own, so asserting the whole list would be an assertion about the fixture.
    const positions = ['Big Yusupova', 'Small Yusupova', 'Never Yusupova'].map((name) =>
      body.items.findIndex((item) => item.name === name),
    );
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions[0]).toBeLessThan(positions[1]!);
    // Somebody who has never ordered sorts last, not first: COALESCE over the left join's NULL.
    expect(positions[1]).toBeLessThan(positions[2]!);
  });

  it('pages without the aggregate join multiplying the total', async () => {
    const { id } = await register('many@example.com');
    for (const total of [100, 200, 300, 400]) {
      await giveOrder(id, 'many@example.com', 'paid', total);
    }

    const body = (
      await get('/api/admin/customers?q=many&perPage=20')
    ).json<AdminCustomerListResponse>();
    // One customer with four orders is one row and a total of one, not four.
    expect(body.items).toHaveLength(1);
    expect(body.meta.total).toBe(1);
  });

  it('never returns the password hash', async () => {
    const { id } = await register('secret@example.com');
    const detail = await get(`/api/admin/customers/${String(id)}`);
    expect(detail.body).not.toContain('$argon2');
    expect(detail.json<Record<string, unknown>>()).not.toHaveProperty('passwordHash');
  });

  it('finds people by name as well as by email', async () => {
    await register('findable@example.com', 'Gulnora');

    for (const q of ['Gulnora', 'findable@']) {
      const body = (
        await get(`/api/admin/customers?q=${encodeURIComponent(q)}`)
      ).json<AdminCustomerListResponse>();
      expect(body.items.map((item) => item.email)).toContain('findable@example.com');
    }
  });

  it('treats a percent sign in the search as a character, not a wildcard', async () => {
    await register('literal@example.com');

    const body = (await get('/api/admin/customers?q=%25')).json<AdminCustomerListResponse>();
    // Unescaped, `%` would match every customer in the shop.
    expect(body.items).toHaveLength(0);
  });

  // ------------------------------------------------------------------ blocking, and what it means

  it('blocks an account and revokes its refresh families in the same transaction', async () => {
    const { id } = await register('blocked@example.com');

    const before = await app.db.select().from(refreshTokens).where(eq(refreshTokens.subjectId, id));
    expect(before.filter((row) => row.revokedAt === null).length).toBeGreaterThan(0);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/customers/${String(id)}/status`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { status: 'blocked' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<AdminCustomerDetail>().status).toBe('blocked');

    const after = await app.db.select().from(refreshTokens).where(eq(refreshTokens.subjectId, id));
    expect(after.every((row) => row.revokedAt !== null)).toBe(true);
    expect(after.map((row) => row.revokedReason)).toContain('blocked_by_admin');
  });

  it('refuses a blocked account’s refresh, rather than minting it a fresh token', async () => {
    await register('refresher@example.com');

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: freshAddress(),
      payload: { email: 'refresher@example.com', password: 'Silk-Grain-2026' },
    });
    const cookie = login.cookies.find((entry) => entry.name === 'sg_refresh');
    expect(cookie).toBeDefined();

    // Blocked directly, leaving the refresh family alive, so this proves the route's own re-read
    // rather than the revocation above. Without it a suspended account refreshes for thirty days.
    await app.db
      .update(customers)
      .set({ status: 'blocked' })
      .where(eq(customers.email, 'refresher@example.com'));

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      remoteAddress: freshAddress(),
      cookies: { sg_refresh: cookie?.value ?? '' },
    });
    expect(refreshed.statusCode).toBe(401);
  });

  it('will not let a blocked guest row be claimed by registering', async () => {
    // A guest checkout leaves a customer row with no password. Blocking it and then registering
    // would otherwise hand the person a session and undo the block.
    await app.db.insert(customers).values({
      email: 'claimed@example.com',
      passwordHash: null,
      firstName: 'Guest',
      lastName: 'Row',
      status: 'blocked',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: freshAddress(),
      payload: {
        email: 'claimed@example.com',
        password: 'Silk-Grain-2026',
        firstName: 'Guest',
        lastName: 'Row',
        marketingOptIn: false,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('restores an account, and makes it sign in again rather than resume', async () => {
    const { id } = await register('restored@example.com');
    const url = `/api/admin/customers/${String(id)}/status`;

    await app.inject({
      method: 'PATCH',
      url,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { status: 'blocked' },
    });
    const response = await app.inject({
      method: 'PATCH',
      url,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { status: 'active' },
    });

    expect(response.json<AdminCustomerDetail>().status).toBe('active');
    const tokens = await app.db.select().from(refreshTokens).where(eq(refreshTokens.subjectId, id));
    // Still all revoked: a restored account starts a session rather than resuming one minted
    // under the old state.
    expect(tokens.every((row) => row.revokedAt !== null)).toBe(true);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: freshAddress(),
      payload: { email: 'restored@example.com', password: 'Silk-Grain-2026' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('lets a support account read customers but not suspend one', async () => {
    const { id } = await register('rbac@example.com');
    await app.db.insert(adminUsers).values({
      email: 'support@silkgrain.test',
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      name: 'Ben C.',
      role: 'support',
    });
    const supportToken = await signIn('support@silkgrain.test');
    const headers = { authorization: `Bearer ${supportToken}` };

    const read = await app.inject({
      method: 'GET',
      url: '/api/admin/customers',
      remoteAddress: freshAddress(),
      headers,
    });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'PATCH',
      url: `/api/admin/customers/${String(id)}/status`,
      remoteAddress: freshAddress(),
      headers,
      payload: { status: 'blocked' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('refuses a body that hopefully carries more than the status', async () => {
    const { id } = await register('strict@example.com');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/customers/${String(id)}/status`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { status: 'blocked', email: 'attacker@example.com' },
    });
    expect(response.statusCode).toBe(422);

    const [row] = await app.db.select().from(customers).where(eq(customers.id, id));
    expect(row?.email).toBe('strict@example.com');
  });

  it('is a 404 for a customer that does not exist', async () => {
    expect((await get('/api/admin/customers/99999')).statusCode).toBe(404);
  });
});
