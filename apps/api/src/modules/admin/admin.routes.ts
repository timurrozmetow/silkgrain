import multipart from '@fastify/multipart';
import {
  AdminCustomerDetail,
  AdminCustomerListQuery,
  AdminCustomerListResponse,
  AdminCustomerStatusInput,
  AdminDashboard,
  AdminImageAltInput,
  AdminImageArrangement,
  AdminOrderDetail,
  AdminOrderListQuery,
  AdminOrderListResponse,
  AdminOrderNoteInput,
  AdminOrderStatusInput,
  AdminPromoActiveInput,
  AdminPromoDetail,
  AdminPromoInput,
  AdminPromoListQuery,
  AdminPromoListResponse,
  AdminPromoUpdateInput,
  AdminProductDetail,
  AdminProductImage,
  AdminProductInput,
  AdminProductListQuery,
  AdminProductListResponse,
  AdminSettings,
  AdminSettingsInput,
  AdminShippingRateInput,
  AdminTrackingInput,
  AdminUserOption,
  AdminWholesaleDetail,
  AdminWholesaleListQuery,
  AdminWholesaleListResponse,
  AdminWholesaleNoteInput,
  AdminWholesaleTriageInput,
  ApiError,
  OrderNumberParams,
  PathId,
} from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError } from '../../lib/errors';

import { getCustomer, listCustomers, setCustomerStatus } from './customers.service';
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
import { createPromo, getPromo, listPromos, setPromoActive, updatePromo } from './promos.service';
import { loadSettings, saveSettings, saveShippingRate } from './settings.service';
import {
  addWholesaleNote,
  getWholesaleRequest,
  listAdminUsers,
  listWholesaleRequests,
  triageWholesaleRequest,
} from './wholesale.service';

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

  // ------------------------------------------------------------------------------- wholesale

  routes.get(
    '/wholesale/requests',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Wholesale enquiries',
        description:
          '`unassigned` is the queue that actually needs somebody: enquiries nobody has taken. ' +
          '`submittedIp` is stored by the public form and never returned here - it exists for ' +
          'investigating a flood of junk, not for printing beside a business name.',
        security: [{ bearerAuth: [] }],
        querystring: AdminWholesaleListQuery,
        response: { 200: AdminWholesaleListResponse, 401: ApiError, 422: ApiError },
      },
    },
    (request) => listWholesaleRequests(app.db, request.query),
  );

  routes.get(
    '/wholesale/requests/:id',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'One enquiry, with its note thread',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: { 200: AdminWholesaleDetail, 401: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    (request) => getWholesaleRequest(app.db, request.params.id),
  );

  routes.patch(
    '/wholesale/requests/:id',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Set the status, the assignee, or both',
        description:
          'One call, because taking an enquiry and marking it contacted is one action to the ' +
          'person doing it. Any status may follow any other: unlike an order there is no money ' +
          'or stock behind it, and an enquiry marked declined in error that then revives is an ' +
          'ordinary Tuesday. `assignedToId: null` hands it back to the pool.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminWholesaleTriageInput,
        response: { 200: AdminWholesaleDetail, 401: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    (request) => triageWholesaleRequest(app.db, request.params.id, request.body),
  );

  routes.post(
    '/wholesale/requests/:id/notes',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Append a note to the thread',
        description:
          'Append-only, and stamped with the author’s name copied into the row: a note has to ' +
          'keep saying who wrote it after that account is removed.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminWholesaleNoteInput,
        response: { 201: AdminWholesaleDetail, 401: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    async (request, reply) => {
      // `requireAdmin` has run, so `auth` is present and its `sub` is the administrator's id.
      const adminUserId = request.auth?.sub;
      if (adminUserId === undefined) throw new AppError('UNAUTHORIZED', 'No administrator');

      const detail = await addWholesaleNote(
        app.db,
        request.params.id,
        adminUserId,
        request.body.body,
      );
      return reply.status(201).send(detail);
    },
  );

  // ------------------------------------------------------------------------------- customers

  routes.get(
    '/customers',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'The people who hold accounts',
        description:
          'A guest checkout writes an order with no customer row, so guests are not here - ' +
          'grouping orders by email to invent one would assert an identity the checkout ' +
          'deliberately declines to assert. Every order at an address, guest or not, is at ' +
          '/admin/orders?q=<email>. Lifetime spend counts only the statuses that mean money was ' +
          'taken and kept, so it agrees with the customer’s own account card to the cent.',
        security: [{ bearerAuth: [] }],
        querystring: AdminCustomerListQuery,
        response: { 200: AdminCustomerListResponse, 401: ApiError, 422: ApiError },
      },
    },
    (request) => listCustomers(app.db, request.query),
  );

  routes.get(
    '/customers/:id',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'One customer, with their ten most recent orders',
        description:
          'The saved addresses and the session list are deliberately absent: an address is the ' +
          'customer’s own and the order already carries the one it shipped to, and a ' +
          'refresh token is a credential.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: { 200: AdminCustomerDetail, 401: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    (request) => getCustomer(app.db, request.params.id),
  );

  routes.patch(
    '/customers/:id/status',
    {
      // The first route in the panel to need more than a session. Suspending somebody is the kind
      // of thing a support account should not be able to do alone.
      onRequest: app.requireRole('owner', 'manager'),
      schema: {
        tags: ['admin'],
        summary: 'Suspend or restore an account',
        description:
          'A sub-path, so PATCH on the customer itself stays unclaimed and nothing implies the ' +
          'rest of the record is editable. Blocking revokes every refresh family the account ' +
          'holds, and POST /api/auth/refresh re-reads the status before it rotates - without ' +
          'both, a suspended account would keep minting access tokens for thirty days. ' +
          'Unblocking revokes too, so a restored account starts a session rather than resuming ' +
          'one from before the suspension.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminCustomerStatusInput,
        response: {
          200: AdminCustomerDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => setCustomerStatus(app.db, request.params.id, request.body.status),
  );

  // ---------------------------------------------------------------------------- promo codes

  routes.get(
    '/promos',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Promo codes, with the state each one is in',
        description:
          '`state` is derived on every read, never stored, in the same order the cart’s own ' +
          'evaluator checks its branches - disabled, scheduled, expired, exhausted, live - so the ' +
          'chip names the condition a customer is actually being told about. The `state` filter is ' +
          'the same rule expressed in SQL, fed the same clock.',
        security: [{ bearerAuth: [] }],
        querystring: AdminPromoListQuery,
        response: { 200: AdminPromoListResponse, 401: ApiError, 422: ApiError },
      },
    },
    (request) => listPromos(app.db, request.query),
  );

  routes.get(
    '/promos/:id',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'One code, with its latest redemptions',
        description:
          '`recordedDiscountCents` is what the order wrote down, which is zero for every ' +
          'free-shipping redemption: the waived postage is not stored anywhere, and today’s ' +
          'rate is not the rate it shipped under.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: { 200: AdminPromoDetail, 401: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    (request) => getPromo(app.db, request.params.id),
  );

  routes.post(
    '/promos',
    {
      onRequest: app.requireRole('owner', 'manager'),
      schema: {
        tags: ['admin'],
        summary: 'Create a promo code',
        description:
          'The discount is a union on its type, so the wrong unit is unrepresentable rather than ' +
          'merely refused - a percentage carries basis points and a cap, a fixed code carries ' +
          'cents and no cap, because `discountFor` applies the cap to both and a $20 code capped ' +
          'at $5 would have the panel and the cart disagreeing. `usedCount` is absent from every ' +
          'input: it is an accounting fact the paid transaction writes.',
        security: [{ bearerAuth: [] }],
        body: AdminPromoInput,
        response: {
          201: AdminPromoDetail,
          401: ApiError,
          403: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    async (request, reply) => reply.status(201).send(await createPromo(app.db, request.body)),
  );

  routes.put(
    '/promos/:id',
    {
      onRequest: app.requireRole('owner', 'manager'),
      schema: {
        tags: ['admin'],
        summary: 'Replace a code’s fields',
        description:
          'Renaming is refused with 409 once any order has ever named the code, at any status: ' +
          '`orders.promo_code` is a snapshot the paid transaction looks the code up by, so a ' +
          'rename reattributes history and leaves a pending order’s redemption unrecorded. ' +
          '`isActive` is not in this body - a stale form would otherwise revert a kill switch ' +
          'somebody threw while it was open.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminPromoUpdateInput,
        response: {
          200: AdminPromoDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => updatePromo(app.db, request.params.id, request.body),
  );

  routes.patch(
    '/promos/:id/active',
    {
      onRequest: app.requireRole('owner', 'manager'),
      schema: {
        tags: ['admin'],
        summary: 'Switch a code on or off',
        description:
          'The terminal action. There is no DELETE: `promo_redemptions` cascades from this row, ' +
          'so deleting a used code destroys the rows a per-customer limit is counted from, and a ' +
          'delete-then-recreate resets every such limit without anybody deciding to.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminPromoActiveInput,
        response: {
          200: AdminPromoDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => setPromoActive(app.db, request.params.id, request.body.isActive),
  );

  // -------------------------------------------------------------------------------- settings

  routes.get(
    '/settings',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'Settings and shipping rates, in one read',
        description:
          'One payload, and that is decision D-22 rather than a convenience: the announcement ' +
          'copy is edited beside the rate row the checkout actually charges from, and both ' +
          'figures have to come from the same read. A key the registry has never heard of is ' +
          'returned as `unregistered` and a key whose stored JSON fails its schema as ' +
          '`malformed`, because a serialiser that refused either would 500 on the one screen ' +
          'that can fix them.',
        security: [{ bearerAuth: [] }],
        response: { 200: AdminSettings, 401: ApiError },
      },
    },
    () => loadSettings(app.db),
  );

  routes.put(
    '/settings',
    {
      onRequest: app.requireRole('owner', 'manager'),
      schema: {
        tags: ['admin'],
        summary: 'Write the settings a card owns',
        description:
          'A partial batch: the body carries only the keys being saved, and they all land or ' +
          'none do. Not `/settings/:key`, because a Fastify body schema is static and cannot ' +
          'depend on a path parameter - a per-key route would need a permissive body and would ' +
          'move the validation out of the contract. A key with no row is a 404, never an insert.',
        security: [{ bearerAuth: [] }],
        body: AdminSettingsInput,
        response: {
          200: AdminSettings,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => saveSettings(app.db, request.body),
  );

  routes.put(
    '/shipping-rates/:id',
    {
      onRequest: app.requireRole('owner', 'manager'),
      schema: {
        tags: ['admin'],
        summary: 'Edit one shipping rate',
        description:
          'Edited and retired, never created or deleted: `SHIPPING_METHOD` is a closed enum and ' +
          '`orders.shipping_method` holds a snapshot of the code, so a deleted rate leaves past ' +
          'orders naming something that no longer exists. `free_above_cents` here is the ' +
          'authority on free shipping (D-22). Refused with 409 when the change would leave no ' +
          'active method, because a checkout with nothing to select cannot take an order.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminShippingRateInput,
        response: {
          200: AdminSettings,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => saveShippingRate(app.db, request.params.id, request.body),
  );

  routes.get(
    '/users',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['admin'],
        summary: 'The team, for the assignee picker',
        description:
          'Names and roles only. Inactive accounts are left out: they cannot be given work.',
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(AdminUserOption), 401: ApiError },
      },
    },
    () => listAdminUsers(app.db),
  );
}
