import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, freshAddress } from '../../test/harness';

/**
 * The two probes, and the one thing `/ready` must not say.
 *
 * `/ready` is the only route in the API that bypasses the scrubbing `plugins/error-handler.ts`
 * performs on every 5xx: it catches its own failures and reports them as data, so nothing in the
 * error path ever sees them. It is also unauthenticated and deliberately exempt from the rate
 * limiter, because a throttled probe reads as an outage. That combination is why the shape of its
 * body is worth a test of its own - a driver message added back here would be readable by anyone
 * who can reach the port, during exactly the incident when it is most informative.
 */
describe('the health probes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers liveness without touching anything external', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: freshAddress(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe('ok');
  });

  it('reports both dependencies as ready, with a latency and nothing else', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/ready',
      remoteAddress: freshAddress(),
    });
    expect(response.statusCode).toBe(200);

    const body = response.json<{
      status: string;
      checks: Record<string, Record<string, unknown>>;
    }>();
    expect(body.status).toBe('ready');

    for (const probe of ['database', 'redis']) {
      // Exactly two keys. An `error` reappearing here is the regression this test exists for, and
      // asserting the key set rather than `error === undefined` catches it under any name.
      expect(Object.keys(body.checks[probe] ?? {}).sort()).toEqual(['latencyMs', 'ok']);
      expect(body.checks[probe]?.['ok']).toBe(true);
    }
  });

  it('carries no host, port, user or path anywhere in its body', async () => {
    // The belt to the previous test's braces: whatever else the payload grows, it must not start
    // describing the infrastructure. `silkgrain_test` is the database this suite connects to, and
    // 3307 is the port - if either appears, something is echoing the connection string.
    const response = await app.inject({
      method: 'GET',
      url: '/ready',
      remoteAddress: freshAddress(),
    });
    expect(response.body).not.toMatch(/silkgrain|3307|6379|127\.0\.0\.1|localhost|ECONNREFUSED/i);
  });
});
