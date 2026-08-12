import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/**
 * `parseParams` coerces the id once, here, so the page reads a number rather than the raw path
 * text. A non-numeric segment throws, which the router turns into the not-found screen.
 *
 * `/products/new` is registered before this in the tree, so "new" is never mistaken for an id.
 */
export const productEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/products/$id/edit',
  parseParams: (params: Record<string, string>) => {
    const id = Number(params['id']);
    if (!Number.isInteger(id) || id <= 0)
      throw new Error(`Not a product id: ${params['id'] ?? ''}`);
    return { id };
  },
  component: lazyRouteComponent(() => import('./product-edit.page')),
});
