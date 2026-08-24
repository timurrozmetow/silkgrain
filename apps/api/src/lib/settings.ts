import { eq } from 'drizzle-orm';

import type { Database } from '../db/client';
import { settings } from '../db/schema';

/**
 * Reads a value the owner edits in the admin panel.
 *
 * `settings.value` is a JSON column, so a setting can be a number, a string or a small object
 * without a migration - which also means nothing guarantees the shape at read time. Every
 * reader states the type it expects and the value it uses when the row is missing or wrong,
 * rather than propagating an `unknown` into a price calculation.
 *
 * Deliberately not cached. One indexed lookup per cart quote is cheaper than a cache that
 * serves a tax rate the owner changed twenty minutes ago and cannot work out how to refresh.
 */
export async function readIntegerSetting(
  db: Database,
  key: string,
  fallback: number,
): Promise<number> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key));

  const value = row?.value;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
}

/**
 * Texas state plus Houston local, matching `.env.example` and the seeded orders.
 *
 * Used only when `commerce.default_tax_basis_points` is missing. It is an estimate either way:
 * decision D-4 puts the authoritative figure in Stripe Tax, once checkout knows the address.
 */
export const DEFAULT_TAX_BASIS_POINTS = 825;
export const TAX_RATE_SETTING = 'commerce.default_tax_basis_points';
