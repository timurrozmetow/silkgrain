import { Money } from '@silkgrain/contracts/money';

/**
 * Turning what an editor types into what the database stores, and back.
 *
 * The form edits dollars and grams because that is what a person reads off a price list and a
 * packet. The database stores cents and milligrams because no business value in this system is a
 * float (the money rule, and decision D-14 for weights). These are the only place that conversion
 * happens, so a rounding decision cannot drift into a component.
 */

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
