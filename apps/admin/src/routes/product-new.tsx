import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const productNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/products/new',
  component: lazyRouteComponent(() => import('./product-new.page')),
});
