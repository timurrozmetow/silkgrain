import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/** `/promos/new` is registered before this, so "new" is never read as an id. */
export const promoDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/promos/$id',
  parseParams: (params: Record<string, string>) => {
    const id = Number(params['id']);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`Not a promo id: ${params['id'] ?? ''}`);
    return { id };
  },
  component: lazyRouteComponent(() => import('./promo-detail.page')),
});
