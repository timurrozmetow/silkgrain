import { createRouter } from '@tanstack/react-router';

import { customerDetailRoute } from './routes/customer-detail';
import { customersRoute } from './routes/customers';
import { dashboardRoute } from './routes/dashboard';
import { orderDetailRoute } from './routes/order-detail';
import { ordersRoute } from './routes/orders';
import { productEditRoute } from './routes/product-edit';
import { productNewRoute } from './routes/product-new';
import { productsRoute } from './routes/products';
import { rootRoute } from './routes/root';
import { wholesaleRoute } from './routes/wholesale';
import { wholesaleDetailRoute } from './routes/wholesale-detail';

/**
 * The panel's route tree, written out as the storefront's is.
 *
 * `basepath` matters: the admin is served under `/admin` in production, so the router has to know
 * that `/admin/orders` is the `/orders` route rather than a 404. Vite's `base` handles the assets;
 * this handles the paths.
 */
const routeTree = rootRoute.addChildren([
  dashboardRoute,
  productsRoute,
  productNewRoute,
  productEditRoute,
  ordersRoute,
  orderDetailRoute,
  wholesaleRoute,
  wholesaleDetailRoute,
  customersRoute,
  customerDetailRoute,
]);

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
