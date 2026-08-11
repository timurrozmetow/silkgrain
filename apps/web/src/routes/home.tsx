import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./home.page')),
});
