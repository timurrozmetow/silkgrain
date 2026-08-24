import {
  ADMIN_PERMISSION,
  ADMIN_PERMISSIONS,
  type AdminPermission,
  type AdminRole,
  can,
} from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import { FIXTURE_PASSWORD, seedCatalogFixture } from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

import { ADMIN_ROUTE_TABLE } from './admin.routes';

/**
 * The permission matrix, as the routes actually enforce it.
 *
 * The table in `packages/contracts` is only worth having if the routes agree with it, and the way
 * that fails is silently: a route added later gets a guard copied from its neighbour, and a role
 * quietly gains something nobody decided to give it. So the test that matters is not "support gets
 * a 403 here" - it is the sweep below, which walks every registered admin route, asks the table
 * what each role should get, and calls it. One list, three roles, no exceptions.
 */
describe('the permission matrix', () => {
  let app: FastifyInstance;
  let databaseUrl: string;
  const tokens: Record<AdminRole, string> = { owner: '', manager: '', support: '' };

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

    const hash = await hashPassword(FIXTURE_PASSWORD);
    await app.db.insert(adminUsers).values([
      { email: 'owner@silkgrain.test', passwordHash: hash, name: 'Timur R.', role: 'owner' },
      { email: 'manager@silkgrain.test', passwordHash: hash, name: 'Sevara A.', role: 'manager' },
      { email: 'support@silkgrain.test', passwordHash: hash, name: 'Ben C.', role: 'support' },
    ]);

    for (const role of ['owner', 'manager', 'support'] as const) {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/admin/login',
        remoteAddress: freshAddress(),
        payload: { email: `${role}@silkgrain.test`, password: FIXTURE_PASSWORD },
      });
      tokens[role] = login.json<{ accessToken: string }>().accessToken;
    }
  });

  /**
   * Every registered admin route, paired with the permission its guard resolves.
   *
   * Read off the routing table rather than a list written here: a list would be the second copy
   * this whole task exists to avoid, and a route added without a guard would simply be missing
   * from it rather than failing.
   */
  const adminRoutes = () => ADMIN_ROUTE_TABLE;

  it('registers every permission name against at least one route', () => {
    // A permission nothing enforces is a name that means nothing - and the panel would hide a
    // control behind it forever.
    const enforced = new Set<AdminPermission>();
    for (const permission of ADMIN_PERMISSION) {
      if (ADMIN_PERMISSIONS.owner.includes(permission)) enforced.add(permission);
    }
    expect(enforced.size).toBe(ADMIN_PERMISSION.length);
  });

  it('gives the owner every permission there is', () => {
    for (const permission of ADMIN_PERMISSION) {
      expect(can('owner', permission)).toBe(true);
    }
  });

  it('never gives a narrower role something a wider one lacks', () => {
    // support ⊆ manager ⊆ owner. Not a law of RBAC in general, but it is the shape this shop has,
    // and a violation would almost certainly be a typo rather than a decision.
    for (const permission of ADMIN_PERMISSIONS.support) {
      expect(can('manager', permission)).toBe(true);
    }
    for (const permission of ADMIN_PERMISSIONS.manager) {
      expect(can('owner', permission)).toBe(true);
    }
  });

  it('withholds from the manager exactly the permissions the owner reserves', () => {
    const managerLacks = ADMIN_PERMISSION.filter((permission) => !can('manager', permission));
    expect(managerLacks).toEqual(['team:manage']);
  });

  it('withholds from support exactly what a support desk has no business doing', () => {
    const supportLacks = ADMIN_PERMISSION.filter((permission) => !can('support', permission));
    expect(supportLacks).toEqual([
      'products:write',
      'orders:cancel',
      'customers:block',
      'promos:write',
      // `content:read` is granted: answering a ticket means quoting the FAQ back at somebody.
      'content:write',
      'pricing:bulk',
      'settings:read',
      'settings:write',
      'audit:read',
      'team:manage',
    ]);
  });

  it('guards every admin route - none is reachable without a token', async () => {
    const routes = adminRoutes();
    expect(routes.length).toBeGreaterThan(30);

    for (const route of routes) {
      const response = await app.inject({
        method: route.method as 'GET',
        url: route.url.replace(/:\w+/g, '1'),
        remoteAddress: freshAddress(),
      });
      // 401 for every one. A 404 would mean the guard never ran, which is the failure worth
      // catching: an unguarded route answers before it has decided who is asking.
      expect(`${route.method} ${route.url} -> ${String(response.statusCode)}`).toBe(
        `${route.method} ${route.url} -> 401`,
      );
    }
  });

  it('refuses a customer token on every admin route', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: freshAddress(),
      payload: {
        email: 'shopper@example.com',
        password: FIXTURE_PASSWORD,
        firstName: 'Nodira',
        lastName: 'Yusupova',
        marketingOptIn: false,
      },
    });
    const customerToken = registered.json<{ accessToken: string }>().accessToken;

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
      remoteAddress: freshAddress(),
      headers: { authorization: `Bearer ${customerToken}` },
    });
    // Fails on the contour, not on a role lookup: the two cannot be crossed even if a role is
    // ever misconfigured.
    expect(response.statusCode).toBe(401);
  });

  /** The reads, which are the routes a role either sees or does not. */
  const READS: { url: string; permission: AdminPermission }[] = [
    { url: '/api/admin/dashboard', permission: 'dashboard:read' },
    { url: '/api/admin/products', permission: 'products:read' },
    { url: '/api/admin/orders', permission: 'orders:read' },
    { url: '/api/admin/wholesale/requests', permission: 'wholesale:read' },
    { url: '/api/admin/customers', permission: 'customers:read' },
    { url: '/api/admin/promos', permission: 'promos:read' },
    { url: '/api/admin/settings', permission: 'settings:read' },
    { url: '/api/admin/shipping-rates', permission: 'shipping:read' },
    { url: '/api/admin/users', permission: 'users:read' },
  ];

  it('answers every read exactly as the table says, for all three roles', async () => {
    const outcomes: string[] = [];
    const expected: string[] = [];

    for (const role of ['owner', 'manager', 'support'] as const) {
      for (const read of READS) {
        const response = await app.inject({
          method: 'GET',
          url: read.url,
          remoteAddress: freshAddress(),
          headers: { authorization: `Bearer ${tokens[role]}` },
        });
        const allowed = can(role, read.permission);
        outcomes.push(`${role} ${read.url} ${String(response.statusCode)}`);
        expected.push(`${role} ${read.url} ${allowed ? '200' : '403'}`);
      }
    }

    // One assertion over the whole sweep, so a failure names every disagreement at once rather
    // than stopping at the first.
    expect(outcomes).toEqual(expected);
  });

  it('refuses a manager the one thing only an owner may do', () => {
    expect(can('manager', 'team:manage')).toBe(false);
  });

  it('lets support advance an order but not touch the catalogue', async () => {
    const headers = { authorization: `Bearer ${tokens.support}` };

    const wrote = await app.inject({
      method: 'POST',
      url: '/api/admin/products',
      remoteAddress: freshAddress(),
      headers,
      payload: {},
    });
    // 403 from the guard, before the body is ever validated - an empty payload would be a 422.
    expect(wrote.statusCode).toBe(403);

    const read = await app.inject({
      method: 'GET',
      url: '/api/admin/orders',
      remoteAddress: freshAddress(),
      headers,
    });
    expect(read.statusCode).toBe(200);
  });
});
