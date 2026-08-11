import type { ProductSort } from '@silkgrain/contracts';
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';
import {
  ENUM_VALUE,
  SLUG,
  WEIGHT_LABEL,
  asCommaList,
  asPositiveInt,
  asSort,
} from './search-params';

/**
 * The catalogue's route.
 *
 * Definition only: `validateSearch` runs before the component's chunk is fetched, so the search
 * parsing lives here and in the initial bundle while the page itself - grid, sidebar, quick
 * view - arrives when somebody actually navigates to `/shop`.
 */

/**
 * Every field optional, so a link to `/shop` need not restate the defaults.
 *
 * TanStack requires a `Link` to supply every non-optional search key, which would mean every
 * "View All Products" in the site spelling out `page: 1, sort: 'featured'` - and a URL
 * carrying its own defaults is a URL that looks filtered when it is not.
 */
export interface ShopSearch {
  page?: number;
  sort?: ProductSort;
  /**
   * Comma-separated slugs, not an array.
   *
   * TanStack serialises an array by JSON-encoding it, so `?category=%5B%22rice%22%5D` - which
   * round-trips correctly and is unreadable. The whole reason filter state lives in the URL is
   * that the URL can be shared, and `?category=rice,lentils` is both legible and exactly the
   * form `ProductListQuery` accepts.
   */
  category?: string;
  /** Comma-separated, for the same reason as `category`. */
  origin?: string;
  cert?: string;
  weight?: string;
  priceMinCents?: number;
  priceMaxCents?: number;
  inStock?: boolean;
  /** What the search overlay hands over when someone presses Enter. */
  q?: string;
}

export const shopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shop',
  // Parsed rather than trusted: these come from the address bar, where anyone can type.
  validateSearch: (raw: Record<string, unknown>): ShopSearch => {
    const page = Number(raw['page']);
    const category = asCommaList(raw['category'], SLUG);
    const origin = asCommaList(raw['origin'], ENUM_VALUE);
    const cert = asCommaList(raw['cert'], ENUM_VALUE);
    const weight = asCommaList(raw['weight'], WEIGHT_LABEL);
    const priceMinCents = asPositiveInt(raw['priceMinCents']);
    const priceMaxCents = asPositiveInt(raw['priceMaxCents']);
    // Defaults are left out rather than written in, so `/shop` stays `/shop`.
    return {
      ...(Number.isInteger(page) && page > 1 ? { page } : {}),
      ...(raw['sort'] === undefined ? {} : { sort: asSort(raw['sort']) }),
      ...(category === undefined ? {} : { category }),
      ...(origin === undefined ? {} : { origin }),
      ...(cert === undefined ? {} : { cert }),
      ...(weight === undefined ? {} : { weight }),
      ...(priceMinCents === undefined ? {} : { priceMinCents }),
      ...(priceMaxCents === undefined ? {} : { priceMaxCents }),
      ...(raw['inStock'] === true || raw['inStock'] === 'true' ? { inStock: true } : {}),
      ...(typeof raw['q'] === 'string' && raw['q'].trim().length > 0
        ? { q: raw['q'].trim().slice(0, 120) }
        : {}),
    };
  },
  component: lazyRouteComponent(() => import('./shop.page')),
});
