import type { ProductSort } from '@silkgrain/contracts';
import { PRODUCT_SORT } from '@silkgrain/contracts/constants';

/**
 * Reading the address bar, for the two routes that let it drive a product grid.
 *
 * Shared by `/shop` and `/shop/c/$slug`, which had a copy each. It also has to sit apart from
 * both pages: `validateSearch` runs before a route's component chunk is fetched, so these
 * functions belong with the route definitions, in the initial bundle, not with the markup they
 * eventually feed.
 *
 * Everything here treats its input as hostile. A search string is whatever somebody typed or
 * pasted, and the values that survive are forwarded to the API.
 */

export const SORT_LABELS: Record<ProductSort, string> = {
  featured: 'Featured',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  newest: 'Newest',
  bestselling: 'Best selling',
  rating: 'Top rated',
};

export function asSort(value: unknown): ProductSort {
  return PRODUCT_SORT.includes(value as ProductSort) ? (value as ProductSort) : 'featured';
}

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ENUM_VALUE = /^[A-Za-z_]{2,20}$/;
/** Weight labels are the designer's strings: "1 lb", "8 oz", "1 kit". */
export const WEIGHT_LABEL = /^[\d.]+ ?[a-z]{1,4}$/;

/**
 * Accepts the comma-separated form and an array, in case an older link is still out there.
 *
 * `allow` keeps the address bar from becoming an injection surface: only values matching the
 * shape the API expects survive, and anything else is dropped rather than forwarded.
 */
export function asCommaList(value: unknown, allow: RegExp): string | undefined {
  const entries = (
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : typeof value === 'string'
        ? value.split(',')
        : []
  )
    .map((entry) => entry.trim())
    .filter((entry) => allow.test(entry));

  return entries.length > 0 ? [...new Set(entries)].join(',') : undefined;
}

export function asPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
