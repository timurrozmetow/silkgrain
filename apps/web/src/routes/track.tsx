import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const trackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/track',
  component: lazyRouteComponent(() => import('./track.page')),
});
