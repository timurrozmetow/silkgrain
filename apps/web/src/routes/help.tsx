import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const helpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/help',
  component: lazyRouteComponent(() => import('./help.page')),
});
