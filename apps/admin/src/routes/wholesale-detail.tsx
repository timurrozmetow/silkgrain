import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/** One enquiry. The id is coerced here, so the page reads a number rather than path text. */
export const wholesaleDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wholesale/$id',
  parseParams: (params: Record<string, string>) => {
    const id = Number(params['id']);
    if (!Number.isInteger(id) || id <= 0)
      throw new Error(`Not an enquiry id: ${params['id'] ?? ''}`);
    return { id };
  },
  component: lazyRouteComponent(() => import('./wholesale-detail.page')),
});
