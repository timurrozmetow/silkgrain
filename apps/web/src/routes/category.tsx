import type { ProductSort } from '@silkgrain/contracts';
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';
import { asSort } from './search-params';

/**
 * A category landing page's route.
 *
 * Definition only - `validateSearch` runs before the component's chunk is fetched, so it stays
 * in the initial bundle while the page arrives on navigation.
 */
export interface CategorySearch {
  page?: number;
  sort?: ProductSort;
  /** A child slug, set by the chips. Absent means the whole branch. */
  child?: string;
}

export const categoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shop/c/$slug',
  validateSearch: (raw: Record<string, unknown>): CategorySearch => {
    const page = Number(raw['page']);
    const child = raw['child'];
    return {
      ...(Number.isInteger(page) && page > 1 ? { page } : {}),
      ...(raw['sort'] === undefined ? {} : { sort: asSort(raw['sort']) }),
      ...(typeof child === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(child) ? { child } : {}),
    };
  },
  component: lazyRouteComponent(() => import('./category.page')),
});
