import type { OrderStatus } from '@silkgrain/contracts';
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/**
 * The order list's route.
 *
 * `validateSearch` runs before the component's chunk loads, so the filter parsing lives here and
 * treats the address bar as hostile: an operator can paste anything into it, and whatever survives
 * is forwarded to the API.
 */
export interface OrderSearch {
  q?: string;
  status?: OrderStatus | 'all';
  needsFulfilment?: boolean;
  page?: number;
}

const STATUSES = new Set([
  'pending',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
  'all',
]);

export const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orders',
  validateSearch: (raw: Record<string, unknown>): OrderSearch => {
    const page = Number(raw['page']);
    const status = raw['status'];
    const q = raw['q'];

    return {
      ...(Number.isInteger(page) && page > 1 ? { page } : {}),
      ...(typeof status === 'string' && STATUSES.has(status)
        ? { status: status as OrderStatus | 'all' }
        : {}),
      ...(typeof q === 'string' && q.trim().length > 0 ? { q: q.trim().slice(0, 120) } : {}),
      ...(raw['needsFulfilment'] === true || raw['needsFulfilment'] === 'true'
        ? { needsFulfilment: true }
        : {}),
    };
  },
  component: lazyRouteComponent(() => import('./orders.page')),
});
