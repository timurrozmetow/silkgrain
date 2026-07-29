import { describe, expect, it } from 'vitest';

import { buildApp } from './app';
import { loadEnv } from './env';

describe('buildApp', () => {
  it('answers /health', async () => {
    const app = buildApp(loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });

    await app.close();
  });
});

describe('loadEnv', () => {
  it('rejects a port outside the valid range', () => {
    expect(() => loadEnv({ API_PORT: '70000' })).toThrow(/API_PORT/);
  });
});
