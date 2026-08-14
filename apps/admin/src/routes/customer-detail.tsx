import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/** One customer. The id is coerced here, so the page reads a number rather than path text. */
export const customerDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/$id',
  parseParams: (params: Record<string, string>) => {
    const id = Number(params['id']);
    if (!Number.isInteger(id) || id <= 0)
      throw new Error(`Not a customer id: ${params['id'] ?? ''}`);
    return { id };
  },
  component: lazyRouteComponent(() => import('./customer-detail.page')),
});
