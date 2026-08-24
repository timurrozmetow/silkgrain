import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/**
 * One screen, no search parameters.
 *
 * The whole tree is six or seven rows and every one of them fits on a page, so there is nothing to
 * filter, sort or paginate. A control that never has work to do is a control that teaches somebody
 * to look for a category that is simply not there.
 */
export const categoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/categories',
  component: lazyRouteComponent(() => import('./categories.page')),
});
