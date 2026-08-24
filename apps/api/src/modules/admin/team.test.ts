import type { AdminTeamList, AdminTeamMember } from '@silkgrain/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, refreshTokens } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import { FIXTURE_PASSWORD, seedCatalogFixture } from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * The Team screen, which is what makes the permission matrix administrable.
 *
 * Nothing could write `admin_users.role` before this: the only way to make somebody a manager was
 * an UPDATE in Studio, so the matrix was a claim the system could not honour.
 *
 * Almost every test here is about one failure - an owner locking themselves or the shop out of its
 * own back office - and the three guards that prevent it. The other thread is credentials: no
 * response in this surface may carry a password hash, and reducing somebody's authority must not
 * leave them holding a token that still says otherwise.
 */
describe('the team', () => {
  let app: FastifyInstance;
  let databaseUrl: string;
  let ownerToken: string;
  let ownerId: number;

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
      { email: 'desk@silkgrain.test', passwordHash: hash, name: 'Ben C.', role: 'support' },
    ]);

    ownerToken = await signIn('owner@silkgrain.test');
    ownerId = await idOf('owner@silkgrain.test');
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

  async function idOf(email: string): Promise<number> {
    const [row] = await app.db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, email));
    return row?.id ?? 0;
  }

  const auth = () => ({ authorization: `Bearer ${ownerToken}` });

  const patch = (id: number, payload: Record<string, unknown>, token = ownerToken) =>
    app.inject({
      method: 'PATCH',
      url: `/api/admin/team/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  const liveSessions = async (id: number) => {
    const rows = await app.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.subjectType, 'admin'),
          eq(refreshTokens.subjectId, id),
          isNull(refreshTokens.revokedAt),
        ),
      );
    return rows.length;
  };

  it('is closed to a manager, not only to support', async () => {
    for (const email of ['manager@silkgrain.test', 'desk@silkgrain.test']) {
      const token = await signIn(email);

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/team',
        remoteAddress: freshAddress(),
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('lists everybody and never a password hash', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/team',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);

    const { members } = response.json<AdminTeamList>();
    expect(members.map((member) => member.email)).toEqual(
      expect.arrayContaining([
        'owner@silkgrain.test',
        'manager@silkgrain.test',
        'desk@silkgrain.test',
      ]),
    );
    // The row carries one and the schema has no field for it, so the serialiser cannot emit it.
    expect(response.body).not.toContain('$argon2');
    expect(response.body).not.toContain('passwordHash');
  });

  it('adds an administrator who can then sign in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/team',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: {
        email: 'newhire@silkgrain.test',
        name: 'Aziza K.',
        role: 'support',
        password: FIXTURE_PASSWORD,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<AdminTeamMember>().role).toBe('support');

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'newhire@silkgrain.test', password: FIXTURE_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses a duplicate email with a 409 rather than a unique-index 500', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/team',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: {
        email: 'manager@silkgrain.test',
        name: 'Somebody Else',
        role: 'support',
        password: FIXTURE_PASSWORD,
      },
    });
    expect(response.statusCode).toBe(409);
  });

  it('refuses a password the customer policy would refuse', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/team',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: {
        email: 'weak@silkgrain.test',
        name: 'Weak Password',
        role: 'support',
        password: 'short',
      },
    });
    // One policy for staff and customers, stated once and derived by `.pick()` for the reset.
    expect(response.statusCode).toBe(422);
  });

  it('will not let an owner change their own role', async () => {
    const response = await patch(ownerId, { role: 'manager' });
    // Well-formed and authorised; the resulting state is what is refused.
    expect(response.statusCode).toBe(409);

    const [row] = await app.db.select().from(adminUsers).where(eq(adminUsers.id, ownerId));
    expect(row?.role).toBe('owner');
  });

  it('will not let an owner deactivate themselves', async () => {
    const response = await patch(ownerId, { isActive: false });
    expect(response.statusCode).toBe(409);
  });

  it('lets an owner rename themselves, which locks nobody out', async () => {
    const response = await patch(ownerId, { name: 'Timur Rozmetov' });
    expect(response.statusCode).toBe(200);
    expect(response.json<AdminTeamMember>().name).toBe('Timur Rozmetov');
  });

  it('refuses any change that would leave the shop with no active owner', async () => {
    // A second owner, so the first can be demoted at all.
    await app.inject({
      method: 'POST',
      url: '/api/admin/team',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: {
        email: 'second@silkgrain.test',
        name: 'Second Owner',
        role: 'owner',
        password: FIXTURE_PASSWORD,
      },
    });
    const secondId = await idOf('second@silkgrain.test');

    // Demoting the second owner is fine - the first survives.
    expect((await patch(secondId, { role: 'manager' })).statusCode).toBe(200);

    // Now the first is the only owner, and only they can call this route. Sign in as the second
    // account, now a manager, and confirm it cannot reach the route at all.
    const managerToken = await signIn('second@silkgrain.test');
    expect((await patch(ownerId, { role: 'manager' }, managerToken)).statusCode).toBe(403);
  });

  it('promotes and demotes, and revokes only on the way down', async () => {
    const deskId = await idOf('desk@silkgrain.test');
    await signIn('desk@silkgrain.test');
    expect(await liveSessions(deskId)).toBe(1);

    // Up: the person is trusted with more, and signing them out to say so buys nothing - their
    // next refresh re-reads the row anyway.
    expect((await patch(deskId, { role: 'manager' })).statusCode).toBe(200);
    expect(await liveSessions(deskId)).toBe(1);

    // Down: they must not keep a fifteen-minute token that still says manager.
    expect((await patch(deskId, { role: 'support' })).statusCode).toBe(200);
    expect(await liveSessions(deskId)).toBe(0);
  });

  it('ends every session when an account is deactivated', async () => {
    const managerId = await idOf('manager@silkgrain.test');
    const managerToken = await signIn('manager@silkgrain.test');
    expect(await liveSessions(managerId)).toBe(1);

    expect((await patch(managerId, { isActive: false })).statusCode).toBe(200);
    expect(await liveSessions(managerId)).toBe(0);

    // The access token outlives the row for up to fifteen minutes; the refresh does not, so the
    // session cannot be renewed and dies with it.
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/refresh',
      remoteAddress: freshAddress(),
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(refreshed.statusCode).toBe(401);
  });

  it('refuses a deactivated account at the door', async () => {
    const managerId = await idOf('manager@silkgrain.test');
    await patch(managerId, { isActive: false });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'manager@silkgrain.test', password: FIXTURE_PASSWORD },
    });
    // 403, not 401, and the distinction is deliberate: the password was right. The customer
    // contour answers a blocked account the same way (D-29), and telling somebody their
    // credentials are wrong when they are not sends them to reset a password that works.
    expect(login.statusCode).toBe(403);
  });

  it('refuses an update that changes nothing', async () => {
    const response = await patch(await idOf('desk@silkgrain.test'), {});
    expect(response.statusCode).toBe(422);
  });

  it('will not let the email be edited, whatever the body carries', async () => {
    const response = await patch(await idOf('desk@silkgrain.test'), {
      email: 'somebody.else@silkgrain.test',
    });
    // The login identity and the unique key. Changing it moves an account somebody may be trying
    // to sign in to.
    expect(response.statusCode).toBe(422);
  });

  it('resets somebody else’s password and ends their sessions', async () => {
    const deskId = await idOf('desk@silkgrain.test');
    await signIn('desk@silkgrain.test');
    expect(await liveSessions(deskId)).toBe(1);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/team/${String(deskId)}/password`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { password: 'A-New-Password-2026' },
    });
    expect(response.statusCode).toBe(204);
    // A password changed because it may have leaked also ends every session it may have leaked
    // into.
    expect(await liveSessions(deskId)).toBe(0);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'desk@silkgrain.test', password: 'A-New-Password-2026' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('will not let an owner reset their own password from here', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/team/${String(ownerId)}/password`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { password: 'A-New-Password-2026' },
    });
    // That goes through the account, which asks for the current password first.
    expect(response.statusCode).toBe(409);
  });

  it('is a 404 for an administrator who does not exist', async () => {
    expect((await patch(99_999, { name: 'Nobody' })).statusCode).toBe(404);
  });

  it('offers no way to delete an account', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/admin/team/${String(await idOf('desk@silkgrain.test'))}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    // Deleting one nulls its audit entries, orphans the wholesale notes it wrote and empties the
    // enquiries it was assigned. `is_active = false` is the terminal action.
    expect(response.statusCode).toBe(404);
  });
});
