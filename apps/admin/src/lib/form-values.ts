import { Money } from '@silkgrain/contracts/money';

/**
 * Turning what an editor types into what the database stores, and back.
 *
 * The form edits dollars and grams because that is what a person reads off a price list and a
 * packet. The database stores cents and milligrams because no business value in this system is a
 * float (the money rule, and decision D-14 for weights). These are the only place that conversion
 * happens, so a rounding decision cannot drift into a component.
 */

/**
 * A name as typed → the slug the `Slug` primitive will accept.
 *
 * Shared by the product form and the category form rather than written in each: both offer to
 * follow the name until an editor edits the slug by hand, and two copies of that rule would be two
 * chances to produce a slug the contract rejects on arrival.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Dollars as typed → integer cents, or null when the field is empty or not a number. */
export function dollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  try {
    return Money.parse(trimmed).cents;
  } catch {
    return null;
  }
}

export function centsToDollars(cents: number | null): string {
  if (cents === null) return '';
  return (cents / 100).toFixed(2);
}

/**
 * Grams as typed → integer milligrams.
 *
 * `1.5` becomes `1500`, exactly. A value finer than a milligram is a data-entry slip rather than a
 * quantity, so it comes back null rather than being rounded away silently.
 */
export function gramsToMg(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const grams = Number(trimmed);
  if (!Number.isFinite(grams) || grams < 0) return null;
  const mg = grams * 1000;
  const rounded = Math.round(mg);
  return Math.abs(mg - rounded) > 1e-6 ? null : rounded;
}

export function mgToGrams(mg: number | null): string {
  if (mg === null) return '';
  // Trailing zeroes trimmed: 1500 mg reads as "1.5", not "1.500".
  return String(mg / 1000);
}

/** A plain non-negative integer field: stock, calories, servings. */
export function toInt(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * A percentage a person types, to the basis points a promo code stores.
 *
 * `10` and `12.5` both round-trip exactly - one column of basis points is precisely why the store
 * carries no decimal. Anything finer than a hundredth of a per cent is null, the same way
 * `dollarsToCents` refuses a third decimal place: it is a value the column cannot hold.
 */
export function percentToBasisPoints(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  const points = value * 100;
  return Number.isInteger(points) ? points : null;
}

/** And back, trailing zeroes trimmed: 1000 bp reads as "10", 1250 as "12.5". */
export function basisPointsToPercent(points: number | null): string {
  if (points === null) return '';
  return String(points / 100);
}

/**
 * A datetime-local input's value to an ISO instant, and back.
 *
 * The `<input type="datetime-local">` speaks a `YYYY-MM-DDTHH:mm` string in the browser's own zone
 * and carries no offset. `new Date(local)` reads it in that zone, and `toISOString` stamps the UTC
 * the API stores - so a code scheduled for "9am" starts at 9am where the operator sits.
 */
export function localToIso(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isoToLocal(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  // Shift by the local offset so `toISOString().slice` prints local wall-clock, not UTC.
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
