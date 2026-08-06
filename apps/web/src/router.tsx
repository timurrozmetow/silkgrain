import { createRouter } from '@tanstack/react-router';

import { cartRoute } from './routes/cart';
import { homeRoute } from './routes/home';
import { productRoute } from './routes/product';
import { rootRoute } from './routes/root';
import { shopRoute } from './routes/shop';

/**
 * The route tree, written out rather than generated from the filesystem.
 *
 * A file-based tree needs a Vite plugin and a generated file in the repository; a code-based
 * one is the same type safety with nothing to regenerate and nothing to commit that a build
 * step owns. It also puts every route in one list, which is the list a reviewer wants.
 */
const routeTree = rootRoute.addChildren([homeRoute, shopRoute, productRoute, cartRoute]);

export const router = createRouter({
  routeTree,
  // Fetches the route's data on hover, so a click has nothing left to wait for.
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  // Back and forward restore where the page was; a new route starts at the top. Doing this by
  // hand is the classic source of "I clicked a product and landed halfway down its page".
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
