import type { ProductStatus } from '@silkgrain/contracts';
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/**
 * The product list's route.
 *
 * `validateSearch` runs before the component's chunk is fetched, so the filter parsing lives here.
 * It treats the address bar as hostile for the same reason the storefront's does: an operator can
 * paste anything into it, and whatever survives is forwarded to the API.
 */
export interface ProductSearch {
  q?: string;
  status?: ProductStatus | 'all';
  category?: string;
  lowStock?: boolean;
  page?: number;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUSES = new Set(['active', 'draft', 'archived', 'all']);

export const productsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/products',
  validateSearch: (raw: Record<string, unknown>): ProductSearch => {
    const page = Number(raw['page']);
    const status = raw['status'];
    const category = raw['category'];
    const q = raw['q'];

    return {
      ...(Number.isInteger(page) && page > 1 ? { page } : {}),
      ...(typeof status === 'string' && STATUSES.has(status)
        ? { status: status as ProductStatus | 'all' }
        : {}),
      ...(typeof category === 'string' && SLUG.test(category) ? { category } : {}),
      ...(typeof q === 'string' && q.trim().length > 0 ? { q: q.trim().slice(0, 120) } : {}),
      ...(raw['lowStock'] === true || raw['lowStock'] === 'true' ? { lowStock: true } : {}),
    };
  },
  component: lazyRouteComponent(() => import('./products.page')),
});
