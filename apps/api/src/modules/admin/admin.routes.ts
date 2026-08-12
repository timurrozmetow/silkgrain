import {
  AdminDashboard,
  AdminProductListQuery,
  AdminProductListResponse,
  ApiError,
} from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { loadDashboard } from './dashboard.service';
import { listAdminProducts } from './products.service';

/**
 * The back office's endpoints.
 *
 * Every route here is behind `requireAdmin`, which checks the token's `typ` as well as its
 * signature - a customer token presented to an admin route fails on the contour, not on a role
 * lookup, so the two cannot be crossed even if a role is ever misconfigured.
 *
 * The dashboard is readable by every role. Role-specific gates arrive with the routes that need
 * them (task 7.8); a read of figures the whole team works from is not one of them.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async by contract
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/dashboard',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Dashboard figures for the last thirty days',
        description:
          'Revenue counts only orders whose money was taken and kept - paid, processing, ' +
          'shipped, delivered - the same definition the customer’s lifetime-spend card uses. A ' +
          'delta against an empty previous window is null rather than zero.',
        security: [{ bearerAuth: [] }],
        response: { 200: AdminDashboard, 401: ApiError },
      },
    },
    () => loadDashboard(app.db),
  );

  routes.get(
    '/products',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'The product list, drafts and archived rows included',
        description:
          'Not the storefront’s query with a flag: this one starts from every product rather ' +
          'than from what a customer may see, which is why it is a separate service. Search ' +
          'covers the SKU as well as the name, because an editor usually has the SKU in hand.',
        security: [{ bearerAuth: [] }],
        querystring: AdminProductListQuery,
        response: { 200: AdminProductListResponse, 401: ApiError, 422: ApiError },
      },
    },
    (request) => listAdminProducts(app.db, request.query),
  );
}
