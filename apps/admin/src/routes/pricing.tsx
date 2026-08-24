import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const pricingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pricing',
  component: lazyRouteComponent(() => import('./pricing.page')),
});
