import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, freshAddress } from './test/harness';

describe('application shell', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the liveness probe without touching anything external', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    expect(response.json<{ uptimeSeconds: number }>().uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('reports readiness with a per-dependency verdict', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      checks: { database: { ok: boolean }; redis: { ok: boolean } };
    }>();
    expect(body.status).toBe('ready');
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.redis.ok).toBe(true);
  });

  it('returns the platform error shape for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string; requestId?: string } }>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeTruthy();
  });

  it('reports a schema violation as VALIDATION_FAILED with the offending paths', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: freshAddress(),
      payload: { email: 'not-an-email' },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<{ error: { code: string; details: { path: string }[] } }>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });

  it('rejects an unknown field rather than ignoring it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: freshAddress(),
      payload: { email: 'a@example.com', password: 'whatever', isAdmin: true },
    });

    expect(response.statusCode).toBe(422);
  });

  it('sets the security headers helmet is configured for', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('serves the OpenAPI document outside production', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(response.statusCode).toBe(200);
    const document = response.json<{ paths: Record<string, unknown>; info: { title: string } }>();
    expect(document.info.title).toBe('SilkGrain API');
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/health', '/ready', '/api/auth/login', '/api/auth/refresh']),
    );
  });
});
