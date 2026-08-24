import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const promoNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/promos/new',
  component: lazyRouteComponent(() => import('./promo-new.page')),
});
