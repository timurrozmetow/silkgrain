import type { PromoState } from '@silkgrain/contracts';
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export interface PromoSearch {
  q?: string;
  state?: PromoState | 'all';
  page?: number;
}

const STATES = new Set(['live', 'scheduled', 'exhausted', 'expired', 'disabled', 'all']);

export const promosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/promos',
  validateSearch: (raw: Record<string, unknown>): PromoSearch => {
    const page = Number(raw['page']);
    const state = raw['state'];
    const q = raw['q'];

    return {
      ...(Number.isInteger(page) && page > 1 ? { page } : {}),
      ...(typeof state === 'string' && STATES.has(state)
        ? { state: state as PromoState | 'all' }
        : {}),
      ...(typeof q === 'string' && q.trim().length > 0 ? { q: q.trim().slice(0, 120) } : {}),
    };
  },
  component: lazyRouteComponent(() => import('./promos.page')),
});
