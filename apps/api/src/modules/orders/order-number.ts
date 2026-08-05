import { sql } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { orders } from '../../db/schema';
import { AppError } from '../../lib/errors';

/**
 * `SG-2026-00001` - decision D-3, a per-year sequence padded to five digits.
 *
 * There is no counter table. The number is derived from the largest one already issued this
 * year, which is exact because the format is fixed-width and zero-padded, so MAX() over the
 * text column is MAX() over the sequence. Two checkouts at the same instant can read the same
 * maximum, and that is what `orders_number_uq` is for: the loser of the race hits the unique
 * index and asks again, rather than being prevented by a lock nobody would otherwise need.
 *
 * A counter table would move the same contention into a row that every order must serialise
 * on, and would drift from reality the first time a row was inserted by hand.
 */

const SEQUENCE_WIDTH = 5;
const MAX_SEQUENCE = 99_999;

export function formatOrderNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${String(year)}-${String(sequence).padStart(SEQUENCE_WIDTH, '0')}`;
}

/**
 * Reads the last number issued this year and returns the next one.
 *
 * Not unique on its own - see above. Callers insert inside `withOrderNumber`, which is where
 * the collision is handled.
 */
export async function nextOrderNumber(
  executor: DbExecutor,
  prefix: string,
  when: Date,
): Promise<string> {
  const year = when.getUTCFullYear();
  // The underscore is a single-character wildcard in LIKE, so the prefix is matched with an
  // explicit pattern rather than by interpolation: `SG_2026-%` would match `SGX2026-...`.
  const pattern = `${prefix}-${String(year)}-%`;

  const [row] = await executor
    .select({ highest: sql<string | null>`MAX(${orders.orderNumber})` })
    .from(orders)
    .where(sql`${orders.orderNumber} LIKE ${pattern}`);

  const highest = row?.highest ?? null;
  const previous = highest === null ? 0 : Number(highest.slice(-SEQUENCE_WIDTH));
  const next = previous + 1;

  if (!Number.isSafeInteger(next) || next > MAX_SEQUENCE) {
    // Ninety-nine thousand orders in one year is a good problem, but it is still a problem,
    // and a silently wrapped sequence would collide with January's numbers.
    throw new AppError(
      'INTERNAL',
      `Order numbers for ${String(year)} are exhausted; widen the sequence`,
    );
  }

  return formatOrderNumber(prefix, year, next);
}

/**
 * MySQL's duplicate-key error, narrowed to the order number's own index.
 *
 * Checking the index name matters: an order insert can violate more than one constraint, and
 * retrying a foreign-key failure forever would turn a bad request into a hung request.
 */
export function isDuplicateOrderNumber(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== 'ER_DUP_ENTRY') return false;
  return typeof candidate.message === 'string' && candidate.message.includes('orders_number_uq');
}

/** Enough attempts to survive a burst, few enough that a real fault surfaces quickly. */
const MAX_ATTEMPTS = 5;

/**
 * Allocates a number, runs the insert, and tries again if someone else took it first.
 *
 * The whole insert is retried rather than only the number, because the number is chosen from a
 * read that the retry has to redo anyway.
 */
export async function withOrderNumber<Result>(
  executor: DbExecutor,
  prefix: string,
  when: Date,
  insert: (orderNumber: string) => Promise<Result>,
): Promise<Result> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const orderNumber = await nextOrderNumber(executor, prefix, when);
    try {
      return await insert(orderNumber);
    } catch (error) {
      if (!isDuplicateOrderNumber(error)) throw error;
      lastError = error;
    }
  }

  throw new AppError('INTERNAL', 'Could not allocate an order number', { cause: lastError });
}
