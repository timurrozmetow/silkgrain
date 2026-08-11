import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const wholesaleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wholesale',
  component: lazyRouteComponent(() => import('./wholesale.page')),
});
