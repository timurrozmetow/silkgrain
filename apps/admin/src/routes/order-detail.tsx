import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

/** `SG-YYYY-NNNNN`, the same shape the API's `OrderNumber` schema accepts. */
const ORDER_NUMBER = /^[A-Z]{2,4}-\d{4}-\d{5}$/;

/**
 * One order, addressed by its number rather than its id.
 *
 * An operator always has the number - it is what the customer quotes - so the URL is the thing they
 * can type. A malformed segment throws here rather than reaching the API, which would answer 422.
 */
export const orderDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orders/$orderNumber',
  parseParams: (params: Record<string, string>) => {
    const orderNumber = params['orderNumber'] ?? '';
    if (!ORDER_NUMBER.test(orderNumber)) throw new Error(`Not an order number: ${orderNumber}`);
    return { orderNumber };
  },
  component: lazyRouteComponent(() => import('./order-detail.page')),
});
