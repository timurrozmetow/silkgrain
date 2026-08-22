import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, customers, refreshTokens } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import { buildTestApp, cookieFrom, freshAddress, truncateAll, testEnv } from '../../test/harness';

import { REFRESH_COOKIE } from './tokens';

const PASSWORD = 'Silk-Grain-2026';

const REGISTRATION = {
  email: 'customer@example.com',
  password: PASSWORD,
  firstName: 'Dilshod',
  lastName: 'Rakhimov',
  marketingOptIn: true,
};

interface AuthBody {
  accessToken: string;
  expiresIn: number;
  customer: { id: number; email: string; emailVerified: boolean };
}

describe('customer authentication', () => {
  let app: FastifyInstance;
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
  });

  async function register(overrides: Partial<typeof REGISTRATION> = {}) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: freshAddress(),
      payload: { ...REGISTRATION, ...overrides },
    });
  }

  async function login(payload = { email: REGISTRATION.email, password: PASSWORD }) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: freshAddress(),
      payload,
    });
  }

  it('registers a customer and returns an access token plus an httpOnly refresh cookie', async () => {
    const response = await register();

    expect(response.statusCode).toBe(201);
    const body = response.json<AuthBody>();
    expect(body.customer.email).toBe(REGISTRATION.email);
    expect(body.expiresIn).toBe(900);
    expect(body.accessToken.split('.')).toHaveLength(3);

    const setCookie = response.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(raw).toContain(`${REFRESH_COOKIE.customer}=`);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    expect(raw).toContain('Path=/api/auth');

    // No `Domain`, so the cookie is host-only. Naming a domain widens it in both directions:
    // the apex would send the session to every subdomain, and every subdomain could set one the
    // apex reads - `Secure` does not prevent that, a sibling over HTTPS can do it too. With
    // `media.silkgrain.com` serving images under the same apex in production, that is a real
    // host, and `Path=/api/auth` means the cookie it could toss is this one.
    expect(raw).not.toContain('Domain=');
  });

  it('stores the password as an Argon2id hash and never returns it', async () => {
    await register();

    const row = await app.db.query.customers.findFirst({
      where: eq(customers.email, REGISTRATION.email),
    });
    expect(row?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(row?.passwordHash).not.toContain(PASSWORD);
  });

  it('stores the refresh token hashed, not in the clear', async () => {
    const response = await register();
    const token = cookieFrom(response.headers, REFRESH_COOKIE.customer);
    expect(token).toBeTruthy();

    const rows = await app.db.select().from(refreshTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toHaveLength(64);
    expect(rows[0]?.tokenHash).not.toBe(token);
  });

  it('refuses a second account for the same email', async () => {
    await register();
    const response = await register();

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('CONFLICT');
  });

  it('lets a guest customer claim their row by registering later', async () => {
    // A guest checkout creates the customer with no password; registering must set one
    // rather than fail with a conflict.
    await app.db.insert(customers).values({
      email: 'guest@example.com',
      passwordHash: null,
      firstName: 'Guest',
      lastName: 'Buyer',
    });

    const response = await register({ email: 'guest@example.com' });

    expect(response.statusCode).toBe(201);
    const row = await app.db.query.customers.findFirst({
      where: eq(customers.email, 'guest@example.com'),
    });
    expect(row?.passwordHash).toBeTruthy();
    expect(row?.firstName).toBe('Dilshod');
  });

  it('rejects a password that does not meet the policy', async () => {
    const response = await register({ password: 'short1' });

    expect(response.statusCode).toBe(422);
    const body = response.json<{ error: { details: { path: string }[] } }>();
    expect(body.error.details.some((issue) => issue.path === 'password')).toBe(true);
  });

  it('signs in with the right password', async () => {
    await register();
    const response = await login();

    expect(response.statusCode).toBe(200);
    expect(response.json<AuthBody>().customer.email).toBe(REGISTRATION.email);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    await register();

    const wrongPassword = await login({ email: REGISTRATION.email, password: 'Wrong-Password-1' });
    const unknownAccount = await login({ email: 'nobody@example.com', password: PASSWORD });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    expect(unknownAccount.json<{ error: { message: string } }>().error.message).toBe(
      wrongPassword.json<{ error: { message: string } }>().error.message,
    );
  });

  it('refuses a blocked account', async () => {
    await register();
    await app.db
      .update(customers)
      .set({ status: 'blocked' })
      .where(eq(customers.email, REGISTRATION.email));

    const response = await login();

    expect(response.statusCode).toBe(403);
  });

  it('locks out brute force after ten attempts from one address', async () => {
    await register();
    const address = freshAddress();

    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: address,
        payload: { email: REGISTRATION.email, password: 'Wrong-Password-1' },
      });

    for (let n = 0; n < 10; n += 1) {
      expect((await attempt()).statusCode).toBe(401);
    }

    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('RATE_LIMITED');
  });
});

describe('refresh token rotation', () => {
  let app: FastifyInstance;
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
  });

  async function startSession() {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: freshAddress(),
      payload: REGISTRATION,
    });
    const token = cookieFrom(response.headers, REFRESH_COOKIE.customer);
    if (!token) throw new Error('registration did not set a refresh cookie');
    return { token, accessToken: response.json<AuthBody>().accessToken };
  }

  function refresh(token: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      remoteAddress: freshAddress(),
      cookies: { [REFRESH_COOKIE.customer]: token },
    });
  }

  it('issues a new access token and rotates the cookie', async () => {
    const session = await startSession();

    const response = await refresh(session.token);

    expect(response.statusCode).toBe(200);
    const rotated = cookieFrom(response.headers, REFRESH_COOKIE.customer);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(session.token);
    expect(response.json<{ accessToken: string }>().accessToken.split('.')).toHaveLength(3);
  });

  it('marks the old token revoked and keeps it in the same family', async () => {
    const session = await startSession();
    await refresh(session.token);

    const rows = await app.db.select().from(refreshTokens);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.revokedAt !== null)).toHaveLength(1);
    expect(rows[0]?.revokedReason).toBe('rotated');
    expect(new Set(rows.map((row) => row.familyId)).size).toBe(1);
  });

  it('treats a replayed token as theft and kills the whole family', async () => {
    const session = await startSession();
    const first = await refresh(session.token);
    const rotated = cookieFrom(first.headers, REFRESH_COOKIE.customer);
    expect(rotated).toBeTruthy();

    // The stolen copy of the original token is presented after it has been rotated.
    const replay = await refresh(session.token);
    expect(replay.statusCode).toBe(401);

    // The token the legitimate client holds is dead too - which is the point.
    const afterRevocation = await refresh(rotated ?? '');
    expect(afterRevocation.statusCode).toBe(401);

    const rows = await app.db.select().from(refreshTokens);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
    expect(rows.some((row) => row.revokedReason === 'reuse_detected')).toBe(true);
  });

  it('rejects an expired token and records why', async () => {
    const session = await startSession();
    await app.db.update(refreshTokens).set({ expiresAt: new Date(Date.now() - 1000) });

    const response = await refresh(session.token);

    expect(response.statusCode).toBe(401);
    const rows = await app.db.select().from(refreshTokens);
    expect(rows[0]?.revokedReason).toBe('expired');
  });

  it('rejects a token that was never issued', async () => {
    await startSession();

    const response = await refresh('a'.repeat(64));

    expect(response.statusCode).toBe(401);
  });

  it('revokes the session on logout and clears the cookie', async () => {
    const session = await startSession();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      remoteAddress: freshAddress(),
      cookies: { [REFRESH_COOKIE.customer]: session.token },
    });

    expect(response.statusCode).toBe(204);
    expect((await refresh(session.token)).statusCode).toBe(401);
  });

  it('treats logging out without a session as success', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      remoteAddress: freshAddress(),
    });

    expect(response.statusCode).toBe(204);
  });
});

describe('guards and contour separation', () => {
  let app: FastifyInstance;
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
    await app.db.insert(adminUsers).values({
      email: 'owner@silkgrain.local',
      passwordHash: await hashPassword(PASSWORD),
      name: 'Owner',
      role: 'owner',
    });
  });

  async function customerToken() {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: freshAddress(),
      payload: REGISTRATION,
    });
    return response.json<AuthBody>().accessToken;
  }

  async function adminToken() {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'owner@silkgrain.local', password: PASSWORD },
    });
    return response.json<{ accessToken: string }>().accessToken;
  }

  it('returns the signed-in customer from /me', async () => {
    const token = await customerToken();

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ email: string }>().email).toBe(REGISTRATION.email);
  });

  it('rejects a request with no token, a malformed token and a forged one', async () => {
    const noToken = await app.inject({ method: 'GET', url: '/api/auth/me' });
    const malformed = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    const wrongScheme = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Basic abcdef' },
    });

    expect(noToken.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(401);
    expect(wrongScheme.statusCode).toBe(401);
  });

  it('will not let a customer token satisfy an admin guard', async () => {
    const token = await customerToken();

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/admin/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('will not let an admin token satisfy a customer guard', async () => {
    const token = await adminToken();

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('signs an administrator in, records the login and returns the role', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'owner@silkgrain.local', password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ admin: { role: string } }>().admin.role).toBe('owner');

    const row = await app.db.query.adminUsers.findFirst({
      where: eq(adminUsers.email, 'owner@silkgrain.local'),
    });
    expect(row?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('refuses a disabled administrator', async () => {
    await app.db
      .update(adminUsers)
      .set({ isActive: false })
      .where(eq(adminUsers.email, 'owner@silkgrain.local'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'owner@silkgrain.local', password: PASSWORD },
    });

    expect(response.statusCode).toBe(403);
  });

  it('keeps the two contours on separate cookies', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'owner@silkgrain.local', password: PASSWORD },
    });

    expect(cookieFrom(response.headers, REFRESH_COOKIE.admin)).toBeTruthy();
    expect(cookieFrom(response.headers, REFRESH_COOKIE.customer)).toBeUndefined();
  });

  it('re-reads the role on refresh so a demotion takes effect immediately', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'owner@silkgrain.local', password: PASSWORD },
    });
    const cookie = cookieFrom(login.headers, REFRESH_COOKIE.admin);
    expect(cookie).toBeTruthy();

    await app.db
      .update(adminUsers)
      .set({ role: 'support' })
      .where(eq(adminUsers.email, 'owner@silkgrain.local'));

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/refresh',
      remoteAddress: freshAddress(),
      cookies: { [REFRESH_COOKIE.admin]: cookie ?? '' },
    });

    expect(refreshed.statusCode).toBe(200);
    const claims = JSON.parse(
      Buffer.from(
        refreshed.json<{ accessToken: string }>().accessToken.split('.')[1] ?? '',
        'base64url',
      ).toString('utf8'),
    ) as { role: string; typ: string };
    expect(claims.role).toBe('support');
    expect(claims.typ).toBe('admin');
  });
});
