import multipart from '@fastify/multipart';
import {
  AdminDashboard,
  AdminImageAltInput,
  AdminImageArrangement,
  AdminOrderDetail,
  AdminOrderListQuery,
  AdminOrderListResponse,
  AdminOrderNoteInput,
  AdminOrderStatusInput,
  AdminProductDetail,
  AdminProductImage,
  AdminProductInput,
  AdminProductListQuery,
  AdminProductListResponse,
  AdminTrackingInput,
  ApiError,
  OrderNumberParams,
  PathId,
} from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError } from '../../lib/errors';

import { loadDashboard } from './dashboard.service';
import { addImage, arrangeImages, removeImage, setImageAlt } from './images.service';
import {
  changeOrderStatus,
  getAdminOrder,
  listAdminOrders,
  setAdminNote,
  setTracking,
} from './orders.service';
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

  // ---------------------------------------------------------------------------------- orders

  routes.get(
    '/orders',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'The order list',
        description:
          '`q` matches an order number or an email, which is what a customer quotes when they ' +
          'write in. `needsFulfilment` is the shipping desk’s queue - paid and processing ' +
          'together - which a single status filter cannot express.',
        security: [{ bearerAuth: [] }],
        querystring: AdminOrderListQuery,
        response: { 200: AdminOrderListResponse, 401: ApiError, 422: ApiError },
      },
    },
    (request) => listAdminOrders(app.db, request.query),
  );

  routes.get(
    '/orders/:orderNumber',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'One order, with the transitions it may make',
        description:
          'Addressed by number rather than id: an operator always has the number in front of ' +
          'them, from the customer’s own email. `allowedTransitions` is computed on the server ' +
          'from the transition map, so the buttons a panel draws cannot disagree with what the ' +
          'API will accept.',
        security: [{ bearerAuth: [] }],
        params: OrderNumberParams,
        response: { 200: AdminOrderDetail, 401: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    (request) => getAdminOrder(app.db, request.params.orderNumber),
  );

  routes.patch(
    '/orders/:orderNumber/status',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Move an order along, with the tracking details that come with shipping it',
        description:
          'Refused with 409 when the order cannot reach that status from where it is. `refunded` ' +
          'is never accepted here: a refund is recorded when the provider reports it, and a ' +
          'button that wrote it locally would tell a customer they had been paid back when ' +
          'nothing had left the account. Cancelling an order whose stock was already committed ' +
          'returns it to the shelf with an `cancellation` ledger entry.',
        security: [{ bearerAuth: [] }],
        params: OrderNumberParams,
        body: AdminOrderStatusInput,
        response: {
          200: AdminOrderDetail,
          401: ApiError,
          404: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    async (request) => {
      const { detail, nowShipped } = await changeOrderStatus(
        app.db,
        request.params.orderNumber,
        request.body,
      );
      // After the transaction, never inside it: a mail server having a slow morning must not roll
      // back a shipment that has already left the building. `enqueueEmail` never throws into a
      // request, and the job id makes a second attempt at the same notice a no-op.
      if (nowShipped) {
        await app.enqueueEmail({
          type: 'order_shipped',
          orderNumber: detail.orderNumber,
          email: detail.email,
        });
      }
      return detail;
    },
  );

  routes.put(
    '/orders/:orderNumber/tracking',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Correct the tracking details without touching the status',
        description:
          'Separate from the status change because the common use is fixing a mistyped number on ' +
          'an order that already shipped, and re-shipping it to do so would send a second notice.',
        security: [{ bearerAuth: [] }],
        params: OrderNumberParams,
        body: AdminTrackingInput,
        response: { 200: AdminOrderDetail, 401: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    (request) => setTracking(app.db, request.params.orderNumber, request.body),
  );

  routes.put(
    '/orders/:orderNumber/note',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'The internal note',
        description:
          'Never serialised to a storefront response - `OrderView` has no field for it. This is ' +
          'where staff write things a customer must not read.',
        security: [{ bearerAuth: [] }],
        params: OrderNumberParams,
        body: AdminOrderNoteInput,
        response: { 200: AdminOrderDetail, 401: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    (request) => setAdminNote(app.db, request.params.orderNumber, request.body.adminNote),
  );
}
