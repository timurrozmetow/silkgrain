import multipart from '@fastify/multipart';
import {
  AdminDashboard,
  AdminImageAltInput,
  AdminImageArrangement,
  AdminProductDetail,
  AdminProductImage,
  AdminProductInput,
  AdminProductListQuery,
  AdminProductListResponse,
  ApiError,
  PathId,
} from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError } from '../../lib/errors';

import { loadDashboard } from './dashboard.service';
import { addImage, arrangeImages, removeImage, setImageAlt } from './images.service';
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
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  // Scoped to the admin routes, so the multipart content-type parser never touches the JSON
  // contours. One file, capped: a product photo over 12 MB is a phone dump nobody needs stored.
  await app.register(multipart, { limits: { files: 1, fileSize: 12 * 1024 * 1024 } });

  const ImageParams = z.object({ id: PathId, imageId: PathId });
  const ImageList = z.object({ images: z.array(AdminProductImage) });

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

  // ---------------------------------------------------------------------------------- images

  routes.post(
    '/products/:id/images',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Upload one product image',
        description:
          'multipart/form-data, one file. It is re-encoded to a capped webp with its metadata ' +
          'stripped before storage, and the first image a product gets becomes its primary.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        // The body is multipart, not JSON, so no body schema; the parser reads the file below.
        response: { 201: ImageList, 401: ApiError, 404: ApiError, 413: ApiError, 422: ApiError },
      },
    },
    async (request, reply) => {
      const file = await request.file();
      if (!file) throw new AppError('VALIDATION_FAILED', 'No file was uploaded');

      const buffer = await file.toBuffer();
      // `alt` rides alongside the file as a form field; `file.fields` carries the text parts.
      const altField = file.fields['alt'];
      const alt =
        altField && !Array.isArray(altField) && altField.type === 'field'
          ? String(altField.value)
          : '';

      const images = await addImage(app.db, app.storage, request.params.id, buffer, alt);
      return reply.status(201).send({ images });
    },
  );

  routes.put(
    '/products/:id/images',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Reorder images and choose the primary',
        description:
          '`order` must list every image of the product exactly once. A partial arrangement is ' +
          'rejected whole rather than applied in part.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminImageArrangement,
        response: { 200: ImageList, 401: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    async (request) => ({ images: await arrangeImages(app.db, request.params.id, request.body) }),
  );

  routes.patch(
    '/products/:id/images/:imageId',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Set an image’s alt text',
        security: [{ bearerAuth: [] }],
        params: ImageParams,
        body: AdminImageAltInput,
        response: { 200: ImageList, 401: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    async (request) => ({
      images: await setImageAlt(
        app.db,
        request.params.id,
        request.params.imageId,
        request.body.alt,
      ),
    }),
  );

  routes.delete(
    '/products/:id/images/:imageId',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Delete an image; the primary passes on if it was primary',
        security: [{ bearerAuth: [] }],
        params: ImageParams,
        response: { 200: ImageList, 401: ApiError, 404: ApiError },
      },
    },
    async (request) => ({
      images: await removeImage(app.db, app.storage, request.params.id, request.params.imageId),
    }),
  );
}
