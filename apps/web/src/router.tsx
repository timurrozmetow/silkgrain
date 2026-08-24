import { PageLoader } from '@silkgrain/ui';
import { createRouter } from '@tanstack/react-router';

import { aboutRoute } from './routes/about';
import { accountRoute } from './routes/account';
import { cartRoute } from './routes/cart';
import { categoryRoute } from './routes/category';
import { helpRoute } from './routes/help';
import { homeRoute } from './routes/home';
import { orderRoute } from './routes/order';
import { productRoute } from './routes/product';
import { recipesRoute } from './routes/recipes';
import { rootRoute } from './routes/root';
import { shopRoute } from './routes/shop';
import { trackRoute } from './routes/track';
import { wholesaleRoute } from './routes/wholesale';
import { wishlistRoute } from './routes/wishlist';

/**
 * The route tree, written out rather than generated from the filesystem.
 *
 * A file-based tree needs a Vite plugin and a generated file in the repository; a code-based
 * one is the same type safety with nothing to regenerate and nothing to commit that a build
 * step owns. It also puts every route in one list, which is the list a reviewer wants.
 */
const routeTree = rootRoute.addChildren([
  homeRoute,
  shopRoute,
  categoryRoute,
  productRoute,
  cartRoute,
  aboutRoute,
  helpRoute,
  recipesRoute,
  wishlistRoute,
  accountRoute,
  orderRoute,
  trackRoute,
  wholesaleRoute,
]);

export const router = createRouter({
  routeTree,
  // Fetches the route's data on hover, so a click has nothing left to wait for.
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  // Back and forward restore where the page was; a new route starts at the top. Doing this by
  // hand is the classic source of "I clicked a product and landed halfway down its page".
  scrollRestoration: true,

  /**
   * What a navigation shows while the next page's code is still arriving.
   *
   * Every route is a lazy chunk, so a click on a slow connection used to leave the header and
   * footer in place with nothing between them and no sign anything was happening - which reads as
   * a click that did not register, and is answered by clicking again.
   *
   * `defaultPendingMs` is why it is not a flicker: below 200ms nothing is drawn at all, because a
   * spinner that appears and vanishes inside a fifth of a second is worse than the wait it
   * describes. `defaultPendingMinMs` then keeps it on screen long enough to be read rather than
   * strobing off the moment the chunk lands.
   */
  defaultPendingComponent: PageLoader,
  defaultPendingMs: 200,
  defaultPendingMinMs: 300,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
