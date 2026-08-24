import { PageLoader } from '@silkgrain/ui';
import { createRouter } from '@tanstack/react-router';

import { auditRoute } from './routes/audit';
import { categoriesRoute } from './routes/categories';
import { customerDetailRoute } from './routes/customer-detail';
import { customersRoute } from './routes/customers';
import { dashboardRoute } from './routes/dashboard';
import { faqsRoute } from './routes/faqs';
import { orderDetailRoute } from './routes/order-detail';
import { ordersRoute } from './routes/orders';
import { pricingRoute } from './routes/pricing';
import { productEditRoute } from './routes/product-edit';
import { productNewRoute } from './routes/product-new';
import { productsRoute } from './routes/products';
import { promoDetailRoute } from './routes/promo-detail';
import { promoNewRoute } from './routes/promo-new';
import { promosRoute } from './routes/promos';
import { recipesRoute } from './routes/recipes';
import { rootRoute } from './routes/root';
import { settingsRoute } from './routes/settings';
import { teamRoute } from './routes/team';
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
  categoriesRoute,
  ordersRoute,
  orderDetailRoute,
  wholesaleRoute,
  wholesaleDetailRoute,
  customersRoute,
  customerDetailRoute,
  promosRoute,
  promoNewRoute,
  promoDetailRoute,
  recipesRoute,
  faqsRoute,
  pricingRoute,
  settingsRoute,
  auditRoute,
  teamRoute,
]);

export const router = createRouter({
  routeTree,
  basepath: '/admin',
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  // The same rule as the storefront's, and for the same reason: every screen here is a lazy
  // chunk, and an operator on the shop's own connection is the person most likely to click twice.
  defaultPendingComponent: PageLoader,
  defaultPendingMs: 200,
  defaultPendingMinMs: 300,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
