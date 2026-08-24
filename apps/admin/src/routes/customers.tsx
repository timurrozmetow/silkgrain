import type { CustomerStatus } from '@silkgrain/contracts';
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/** The customer list, with its filters parsed out of the address bar before the chunk loads. */
export interface CustomerSearch {
  q?: string;
  status?: CustomerStatus | 'all';
  sort?: 'newest' | 'spend';
  page?: number;
}

const STATUSES = new Set(['active', 'blocked', 'all']);
const SORTS = new Set(['newest', 'spend']);

export const customersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers',
  validateSearch: (raw: Record<string, unknown>): CustomerSearch => {
    const page = Number(raw['page']);
    const status = raw['status'];
    const sort = raw['sort'];
    const q = raw['q'];

    return {
      ...(Number.isInteger(page) && page > 1 ? { page } : {}),
      ...(typeof status === 'string' && STATUSES.has(status)
        ? { status: status as CustomerStatus | 'all' }
        : {}),
      ...(typeof sort === 'string' && SORTS.has(sort) ? { sort: sort as 'newest' | 'spend' } : {}),
      ...(typeof q === 'string' && q.trim().length > 0 ? { q: q.trim().slice(0, 120) } : {}),
    };
  },
  component: lazyRouteComponent(() => import('./customers.page')),
});
