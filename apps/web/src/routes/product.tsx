import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const productRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/product/$slug',
  component: lazyRouteComponent(() => import('./product.page')),
});
