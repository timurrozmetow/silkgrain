import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const cartRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cart',
  component: lazyRouteComponent(() => import('./cart.page')),
});
