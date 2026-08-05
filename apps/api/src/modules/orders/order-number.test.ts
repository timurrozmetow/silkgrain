import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { orders } from '../../db/schema';
import { buildTestApp, testEnv, truncateAll } from '../../test/harness';

import { formatOrderNumber, nextOrderNumber, withOrderNumber } from './order-number';

/**
 * Order numbers, against the real unique index.
 *
 * The generator is deliberately not race-free on its own - two callers can read the same
 * maximum - so testing it without `orders_number_uq` present would test the half that was
 * never the point.
 */
describe('order numbers', () => {
  let app: FastifyInstance;
  let databaseUrl: string;

  const IN_2026 = new Date('2026-07-30T12:00:00Z');

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

  async function insertOrder(orderNumber: string): Promise<number> {
    const [row] = await app.db
      .insert(orders)
      .values({
        orderNumber,
        email: 'buyer@example.com',
        status: 'pending',
        subtotalCents: 1000,
        totalCents: 1000,
        shippingMethod: 'standard',
      })
      .$returningId();
    if (!row) throw new Error('no order inserted');
    return row.id;
  }

  it('pads the sequence to five digits', () => {
    expect(formatOrderNumber('SG', 2026, 1)).toBe('SG-2026-00001');
    expect(formatOrderNumber('SG', 2026, 12_345)).toBe('SG-2026-12345');
    expect(formatOrderNumber('SILK', 2026, 42)).toBe('SILK-2026-00042');
  });

  it('starts a year at one', async () => {
    expect(await nextOrderNumber(app.db, 'SG', IN_2026)).toBe('SG-2026-00001');
  });

  it('continues from the highest number already issued that year', async () => {
    await insertOrder('SG-2026-00007');
    expect(await nextOrderNumber(app.db, 'SG', IN_2026)).toBe('SG-2026-00008');
  });

  /** Lexicographic MAX() is numeric MAX() only because the width is fixed. */
  it('reads the maximum rather than the newest row', async () => {
    await insertOrder('SG-2026-00042');
    await insertOrder('SG-2026-00009');
    expect(await nextOrderNumber(app.db, 'SG', IN_2026)).toBe('SG-2026-00043');
  });

  it('counts per year, so January restarts', async () => {
    await insertOrder('SG-2025-00500');
    expect(await nextOrderNumber(app.db, 'SG', IN_2026)).toBe('SG-2026-00001');
  });

  /** `_` is a single-character wildcard in LIKE, which is why the pattern is built explicitly. */
  it('does not mistake another prefix for its own', async () => {
    await insertOrder('XX-2026-00300');
    expect(await nextOrderNumber(app.db, 'SG', IN_2026)).toBe('SG-2026-00001');
  });

  it('takes the next number when someone else takes the one it chose', async () => {
    let attempts = 0;

    const id = await withOrderNumber(app.db, 'SG', IN_2026, async (orderNumber) => {
      attempts += 1;
      if (attempts === 1) {
        // Another checkout, a millisecond earlier, reading the same maximum.
        expect(orderNumber).toBe('SG-2026-00001');
        await insertOrder(orderNumber);
      }
      return insertOrder(orderNumber);
    });

    expect(attempts).toBe(2);
    const rows = await app.db.select({ orderNumber: orders.orderNumber }).from(orders);
    expect(rows.map((row) => row.orderNumber).sort()).toEqual(['SG-2026-00001', 'SG-2026-00002']);
    expect(id).toBeGreaterThan(0);
  });

  it('does not retry a failure that is not a collision', async () => {
    await expect(
      withOrderNumber(app.db, 'SG', IN_2026, () => {
        throw new Error('the database is on fire');
      }),
    ).rejects.toThrow('the database is on fire');
  });

  it('refuses to wrap the sequence when a year is exhausted', async () => {
    await insertOrder('SG-2026-99999');
    await expect(nextOrderNumber(app.db, 'SG', IN_2026)).rejects.toThrow(/exhausted/);
  });
});
