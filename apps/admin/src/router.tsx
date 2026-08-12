import { createRouter } from '@tanstack/react-router';

import { dashboardRoute } from './routes/dashboard';
import { rootRoute } from './routes/root';

/**
 * The panel's route tree, written out as the storefront's is.
 *
 * `basepath` matters: the admin is served under `/admin` in production, so the router has to know
 * that `/admin/orders` is the `/orders` route rather than a 404. Vite's `base` handles the assets;
 * this handles the paths.
 */
const routeTree = rootRoute.addChildren([dashboardRoute]);

export const router = createRouter({
  routeTree,
  basepath: '/admin',
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
