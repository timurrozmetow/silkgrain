import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { buildTestApp, freshAddress } from './test/harness';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

const CASES = [
  '100000000000000000000', // 1e20  -> offset 1.6e21 (exponent notation)
  '10000000000000000000', // 1e19  -> offset 1.6e20 (plain digits, > 2^64)
  '1000000000000000', // 1e15  -> offset 1.6e16 (valid, in range)
  '1e20',
  '99999999999999999999999999999999',
  '1e309', // Infinity
  '1.5',
  '0',
  '-1',
];

it('probes unbounded page', async () => {
  for (const page of CASES) {
    const reply = await app.inject({
      method: 'GET',
      url: `/api/products?page=${encodeURIComponent(page)}`,
      remoteAddress: freshAddress(),
    });
    // eslint-disable-next-line no-console
    console.log(
      `page=${page} -> ${String(reply.statusCode)} ${reply.body.slice(0, 160).replace(/\s+/g, ' ')}`,
    );
  }
  expect(true).toBe(true);
});
