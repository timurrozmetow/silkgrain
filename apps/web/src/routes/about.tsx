import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: lazyRouteComponent(() => import('./about.page')),
});
