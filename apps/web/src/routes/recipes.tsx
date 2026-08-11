import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export const recipesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recipes',
  component: lazyRouteComponent(() => import('./recipes.page')),
});
