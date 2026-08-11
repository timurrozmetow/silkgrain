import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const wishlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wishlist',
  component: lazyRouteComponent(() => import('./wishlist.page')),
});
