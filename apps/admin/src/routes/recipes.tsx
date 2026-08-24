import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/**
 * List and editor on one screen.
 *
 * A recipe is one form and there are six of them; a separate `/recipes/new` and `/recipes/$id`
 * would be two more routes and a navigation each way to edit a paragraph. Products get that
 * treatment because a product form is four sections and a gallery.
 */
export const recipesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recipes',
  component: lazyRouteComponent(() => import('./recipes.page')),
});
