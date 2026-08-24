import {
  AccountSummary,
  ApiError,
  OrderLookupQuery,
  OrderNumberParams,
  OrderSummary,
  OrderView,
  PageQuery,
  paginated,
} from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { unauthorized } from '../../lib/errors';

import { getAccountSummary, getOrderByNumber, listCustomerOrders } from './orders.service';

/**
 * Reading orders.
 *
 * The guest route is the tracking page and the confirmation screen for someone who never made
 * an account, which is most people. It is the only unauthenticated route in the platform that
 * returns personal data, so it is also the only one with a limit this tight.
 */
const GUEST_LOOKUP_LIMIT = { rateLimit: { max: 20, timeWindow: '5 minutes' } };

// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async by contract
export async function orderRoutes(app: FastifyInstance): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/orders/:orderNumber',
    {
      config: GUEST_LOOKUP_LIMIT,
      schema: {
        tags: ['orders'],
        summary: 'Look up an order as a guest',
        description:
          'The email the order was placed with is required as well as the number. Order ' +
          'numbers are a per-year sequence and can be walked, so a wrong email and a number ' +
          'that was never issued both answer 404 - otherwise the endpoint would report how ' +
          'many orders the shop has taken.',
        params: OrderNumberParams,
        querystring: OrderLookupQuery,
        response: { 200: OrderView, 404: ApiError, 422: ApiError, 429: ApiError },
      },
    },
    (request) =>
      getOrderByNumber(app.db, request.params.orderNumber, { email: request.query.email }),
  );

  routes.get(
    '/account/summary',
    {
      onRequest: app.requireCustomer,
      schema: {
        tags: ['orders'],
        summary: 'The signed-in customer’s account stat cards',
        security: [{ bearerAuth: [] }],
        response: { 200: AccountSummary, 401: ApiError },
      },
    },
    (request) => {
      const customerId = request.auth?.sub;
      if (customerId === undefined) throw unauthorized();
      return getAccountSummary(app.db, customerId);
    },
  );

  routes.get(
    '/account/orders',
    {
      onRequest: app.requireCustomer,
      schema: {
        tags: ['orders'],
        summary: 'The signed-in customer’s order history',
        security: [{ bearerAuth: [] }],
        querystring: PageQuery,
        response: { 200: paginated(OrderSummary), 401: ApiError },
      },
    },
    (request) => {
      const customerId = request.auth?.sub;
      if (customerId === undefined) throw unauthorized();
      return listCustomerOrders(app.db, customerId, request.query);
    },
  );

  routes.get(
    '/account/orders/:orderNumber',
    {
      onRequest: app.requireCustomer,
      schema: {
        tags: ['orders'],
        summary: 'One of the signed-in customer’s own orders',
        description:
          'No email needed: the session already says who is asking. An order belonging to ' +
          'somebody else is a 404 here too.',
        security: [{ bearerAuth: [] }],
        params: OrderNumberParams,
        response: { 200: OrderView, 401: ApiError, 404: ApiError },
      },
    },
    (request) => {
      const customerId = request.auth?.sub;
      if (customerId === undefined) throw unauthorized();
      return getOrderByNumber(app.db, request.params.orderNumber, { customerId });
    },
  );
}
