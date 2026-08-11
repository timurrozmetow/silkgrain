import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const orderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/order/$orderNumber',
  component: lazyRouteComponent(() => import('./order.page')),
});
