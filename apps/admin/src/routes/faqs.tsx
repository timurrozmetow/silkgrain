import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/**
 * One screen, no search parameters.
 *
 * The FAQ is a handful of entries in five categories and the whole thing fits on a page, so
 * there is nothing to filter or paginate - and the reordering only makes sense against the whole
 * list anyway.
 */
export const faqsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/faqs',
  component: lazyRouteComponent(() => import('./faqs.page')),
});
