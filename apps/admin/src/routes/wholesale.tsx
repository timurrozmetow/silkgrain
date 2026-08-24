import type { WholesaleStatus } from '@silkgrain/contracts';
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/** The enquiry list, with its filters parsed out of the address bar before the chunk loads. */
export interface WholesaleSearch {
  q?: string;
  status?: WholesaleStatus | 'all';
  unassigned?: boolean;
  page?: number;
}

const STATUSES = new Set(['new', 'contacted', 'quoted', 'converted', 'declined', 'all']);

export const wholesaleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wholesale',
  validateSearch: (raw: Record<string, unknown>): WholesaleSearch => {
    const page = Number(raw['page']);
    const status = raw['status'];
    const q = raw['q'];

    return {
      ...(Number.isInteger(page) && page > 1 ? { page } : {}),
      ...(typeof status === 'string' && STATUSES.has(status)
        ? { status: status as WholesaleStatus | 'all' }
        : {}),
      ...(typeof q === 'string' && q.trim().length > 0 ? { q: q.trim().slice(0, 120) } : {}),
      ...(raw['unassigned'] === true || raw['unassigned'] === 'true' ? { unassigned: true } : {}),
    };
  },
  component: lazyRouteComponent(() => import('./wholesale.page')),
});
