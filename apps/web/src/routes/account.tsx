import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: lazyRouteComponent(() => import('./account.page')),
});
