import {
  AdminDashboard,
  AdminProductDetail,
  AdminProductInput,
  AdminProductListQuery,
  AdminProductListResponse,
  ApiError,
  PathId,
} from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { loadDashboard } from './dashboard.service';
import { createProduct, getAdminProduct, updateProduct } from './product-writer.service';
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

  // `PathId` coerces: a path segment is always text, so `Id` could never validate here.
  const IdParams = z.object({ id: PathId });

  routes.get(
    '/products/:id',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'One product, everything the form edits',
        description:
          'Not the storefront’s detail response: that one carries derived badges, a review ' +
          'histogram and related products, and none of the cost price, the draft status or where ' +
          'the nutrition figures came from. Two audiences, two projections.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: { 200: AdminProductDetail, 401: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    (request) => getAdminProduct(app.db, request.params.id),
  );

  routes.post(
    '/products',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Create a product with its variants, certifications and panel',
        description:
          'One transaction. Half a save - new variants beside old certifications - is a state ' +
          'nobody designed. Sending a nutrition panel marks it `entered`; the seed’s ' +
          'category-level averages stay `reference` until somebody types over them (D-20).',
        security: [{ bearerAuth: [] }],
        body: AdminProductInput,
        response: {
          201: AdminProductDetail,
          401: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    async (request, reply) => {
      const created = await createProduct(app.db, request.body);
      return reply.status(201).send(await getAdminProduct(app.db, created.id));
    },
  );

  routes.put(
    '/products/:id',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Replace a product and reconcile its variants',
        description:
          'PUT rather than PATCH, and deliberately: the form sends the whole product every time, ' +
          'and a variant the payload leaves out is deleted. A partial body would make "this ' +
          'variant is gone" indistinguishable from "I did not mention it".',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminProductInput,
        response: {
          200: AdminProductDetail,
          401: ApiError,
          404: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    async (request) => {
      await updateProduct(app.db, request.params.id, request.body);
      return getAdminProduct(app.db, request.params.id);
    },
  );
}
