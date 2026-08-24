import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/team',
  component: lazyRouteComponent(() => import('./team.page')),
});
