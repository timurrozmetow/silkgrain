import multipart from '@fastify/multipart';
import {
  AdminAuditActors,
  AdminAuditEntry,
  AdminAuditQuery,
  AdminAuditResponse,
  AdminCategoryActiveInput,
  AdminCategoryInput,
  AdminCategoryList,
  AdminCategoryUpdateInput,
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
  AdminPriceApplyInput,
  AdminPriceApplyResult,
  AdminPricePreview,
  AdminPricePreviewInput,
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
  AdminShippingRate,
  AdminShippingRateInput,
  AdminTeamCreateInput,
  AdminTeamList,
  AdminTeamMember,
  AdminTeamPasswordInput,
  AdminTeamUpdateInput,
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

import { adminActor, auditContext } from './actor';
import { getAuditEntry, listAudit, listAuditActors } from './audit.read.service';
import {
  clearCategoryImage,
  createCategory,
  listAdminCategories,
  setCategoryActive,
  setCategoryImage,
  updateCategory,
} from './categories.service';
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
import { applyPricing, previewPricing } from './pricing.service';
import { createProduct, getAdminProduct, updateProduct } from './product-writer.service';
import { listAdminProducts } from './products.service';
import { createPromo, getPromo, listPromos, setPromoActive, updatePromo } from './promos.service';
import {
  loadSettings,
  loadShippingRates,
  saveSettings,
  saveShippingRate,
} from './settings.service';
import { createTeamMember, listTeam, resetTeamPassword, updateTeamMember } from './team.service';
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
 * Every route here carries exactly one named permission, resolved from `ADMIN_PERMISSIONS` in
 * `packages/contracts` - the same table the panel reads to decide what to draw, so a control the
 * API would refuse cannot appear (D-30). The guard checks the token's `typ` as well as its
 * signature, so a customer token presented here fails on the contour rather than on a role lookup
 * and the two cannot be crossed even if a role is ever misconfigured.
 *
 * The role comes from the fifteen-minute access token and no database is read, which is the bargain
 * a short-lived stateless token exists to make: a demotion takes effect when the token next
 * refreshes, and `/auth/admin/refresh` re-reads the row to make sure it does. The one exception is
 * `team:manage`, which re-reads on every request because it is the permission that could mint a
 * permanent replacement inside that window (D-32).
 */
/**
 * Every admin route and the permission its guard resolves, recorded as the routes register.
 *
 * The completeness test reads this rather than a list written beside it: a hand-kept list would be
 * exactly the second copy this task exists to remove, and a route added without a guard would be
 * missing from the list rather than failing the test. Fastify's own `printRoutes` cannot serve -
 * it renders a tree and compresses shared prefixes, so a nested path is not printed in full.
 */
export const ADMIN_ROUTE_TABLE: { method: string; url: string }[] = [];

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/admin')) return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD') continue;
      ADMIN_ROUTE_TABLE.push({ method, url: route.url });
    }
  });

  // Scoped to the admin routes, so the multipart content-type parser never touches the JSON
  // contours. One file, capped: a product photo over 12 MB is a phone dump nobody needs stored.
  await app.register(multipart, { limits: { files: 1, fileSize: 12 * 1024 * 1024 } });

  const ImageParams = z.object({ id: PathId, imageId: PathId });
  const ImageList = z.object({ images: z.array(AdminProductImage) });

  routes.get(
    '/dashboard',
    {
      onRequest: app.requirePermission('dashboard:read'),
      schema: {
        tags: ['admin'],
        summary: 'Dashboard figures for the last thirty days',
        description:
          'Revenue counts only orders whose money was taken and kept - paid, processing, ' +
          'shipped, delivered - the same definition the customer’s lifetime-spend card uses. A ' +
          'delta against an empty previous window is null rather than zero.',
        security: [{ bearerAuth: [] }],
        response: { 200: AdminDashboard, 401: ApiError, 403: ApiError },
      },
    },
    () => loadDashboard(app.db),
  );

  routes.get(
    '/products',
    {
      onRequest: app.requirePermission('products:read'),
      schema: {
        tags: ['admin'],
        summary: 'The product list, drafts and archived rows included',
        description:
          'Not the storefront’s query with a flag: this one starts from every product rather ' +
          'than from what a customer may see, which is why it is a separate service. Search ' +
          'covers the SKU as well as the name, because an editor usually has the SKU in hand.',
        security: [{ bearerAuth: [] }],
        querystring: AdminProductListQuery,
        response: { 200: AdminProductListResponse, 401: ApiError, 403: ApiError, 422: ApiError },
      },
    },
    (request) => listAdminProducts(app.db, request.query),
  );

  // `PathId` coerces: a path segment is always text, so `Id` could never validate here.
  const IdParams = z.object({ id: PathId });

  routes.get(
    '/products/:id',
    {
      onRequest: app.requirePermission('products:read'),
      schema: {
        tags: ['admin'],
        summary: 'One product, everything the form edits',
        description:
          'Not the storefront’s detail response: that one carries derived badges, a review ' +
          'histogram and related products, and none of the cost price, the draft status or where ' +
          'the nutrition figures came from. Two audiences, two projections.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          200: AdminProductDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => getAdminProduct(app.db, request.params.id),
  );

  routes.post(
    '/products',
    {
      onRequest: app.requirePermission('products:write'),
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
          403: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    async (request, reply) => {
      const created = await createProduct(
        app.db,
        request.body,
        adminActor(request),
        auditContext(request),
      );
      return reply.status(201).send(await getAdminProduct(app.db, created.id));
    },
  );

  routes.put(
    '/products/:id',
    {
      onRequest: app.requirePermission('products:write'),
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
          403: ApiError,
          404: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    async (request) => {
      await updateProduct(
        app.db,
        request.params.id,
        request.body,
        adminActor(request),
        auditContext(request),
      );
      return getAdminProduct(app.db, request.params.id);
    },
  );

  // ---------------------------------------------------------------------------------- images

  routes.post(
    '/products/:id/images',
    {
      onRequest: app.requirePermission('products:write'),
      schema: {
        tags: ['admin'],
        summary: 'Upload one product image',
        description:
          'multipart/form-data, one file. It is re-encoded to a capped webp with its metadata ' +
          'stripped before storage, and the first image a product gets becomes its primary.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        // The body is multipart, not JSON, so no body schema; the parser reads the file below.
        response: {
          201: ImageList,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          413: ApiError,
          422: ApiError,
        },
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

      const images = await addImage(
        app.db,
        app.storage,
        request.params.id,
        buffer,
        alt,
        adminActor(request),
        auditContext(request),
      );
      return reply.status(201).send({ images });
    },
  );

  routes.put(
    '/products/:id/images',
    {
      onRequest: app.requirePermission('products:write'),
      schema: {
        tags: ['admin'],
        summary: 'Reorder images and choose the primary',
        description:
          '`order` must list every image of the product exactly once. A partial arrangement is ' +
          'rejected whole rather than applied in part.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminImageArrangement,
        response: { 200: ImageList, 401: ApiError, 403: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    async (request) => ({
      images: await arrangeImages(
        app.db,
        request.params.id,
        request.body,
        adminActor(request),
        auditContext(request),
      ),
    }),
  );

  routes.patch(
    '/products/:id/images/:imageId',
    {
      onRequest: app.requirePermission('products:write'),
      schema: {
        tags: ['admin'],
        summary: 'Set an image’s alt text',
        security: [{ bearerAuth: [] }],
        params: ImageParams,
        body: AdminImageAltInput,
        response: { 200: ImageList, 401: ApiError, 403: ApiError, 404: ApiError, 422: ApiError },
      },
    },
    async (request) => ({
      images: await setImageAlt(
        app.db,
        request.params.id,
        request.params.imageId,
        request.body.alt,
        adminActor(request),
        auditContext(request),
      ),
    }),
  );

  routes.delete(
    '/products/:id/images/:imageId',
    {
      onRequest: app.requirePermission('products:write'),
      schema: {
        tags: ['admin'],
        summary: 'Delete an image; the primary passes on if it was primary',
        security: [{ bearerAuth: [] }],
        params: ImageParams,
        response: { 200: ImageList, 401: ApiError, 403: ApiError, 404: ApiError },
      },
    },
    async (request) => ({
      images: await removeImage(
        app.db,
        app.storage,
        request.params.id,
        request.params.imageId,
        adminActor(request),
        auditContext(request),
      ),
    }),
  );

  // ------------------------------------------------------------------------------ categories

  routes.get(
    '/categories',
    {
      onRequest: app.requirePermission('products:read'),
      schema: {
        tags: ['admin'],
        summary: 'The category tree, deactivated rows included',
        description:
          'Not the storefront’s `/api/categories`: that one filters to active, because a customer ' +
          'must not be shown a retired category, and this is the screen where one is brought back. ' +
          'Two counts per row, neither folding in a child’s - `productCount` is everything filed ' +
          'there at any status, `liveCount` is what the shop would show for it if its branch were ' +
          'active.',
        security: [{ bearerAuth: [] }],
        response: { 200: AdminCategoryList, 401: ApiError, 403: ApiError },
      },
    },
    () => listAdminCategories(app.db),
  );

  routes.post(
    '/categories',
    {
      onRequest: app.requirePermission('products:write'),
      schema: {
        tags: ['admin'],
        summary: 'Create a category',
        description:
          'The tree is two levels and the API enforces it rather than trusting the form: a ' +
          'category with a parent may not be given children, a category with children may not be ' +
          'given a parent, and nothing active may be filed under a deactivated one. `imageUrl` is ' +
          'not in this body - a hero is uploaded, never typed, because production serves under ' +
          "`img-src 'self'` and a pasted address renders as a blank rectangle (D-52).",
        security: [{ bearerAuth: [] }],
        body: AdminCategoryInput,
        response: {
          201: AdminCategoryList,
          401: ApiError,
          403: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await createCategory(app.db, request.body, adminActor(request), auditContext(request)),
        ),
  );

  routes.put(
    '/categories/:id',
    {
      onRequest: app.requirePermission('products:write'),
      schema: {
        tags: ['admin'],
        summary: 'Replace a category’s fields',
        description:
          'The slug may be renamed and nothing refuses it, because unlike a promo code no order ' +
          'snapshots it by value. What it costs is a link - `/shop/c/<slug>` is a page somebody ' +
          'may have bookmarked, and this platform has no redirect table - so the panel says so at ' +
          'the field. `isActive` is not in this body: a stale form would otherwise put a whole ' +
          'branch of the catalogue back in the shop without anybody asking.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminCategoryUpdateInput,
        response: {
          200: AdminCategoryList,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    (request) =>
      updateCategory(
        app.db,
        request.params.id,
        request.body,
        adminActor(request),
        auditContext(request),
      ),
  );

  routes.patch(
    '/categories/:id/active',
    {
      onRequest: app.requirePermission('products:write'),
      schema: {
        tags: ['admin'],
        summary: 'Switch a category on or off',
        description:
          'The terminal action - there is no DELETE, because `products.category_id` is ON DELETE ' +
          'restrict and `parent_id` is ON DELETE set null, so a delete would be refused for a ' +
          'used category and would silently promote a child for an unused one. Switching a ' +
          'category off takes its products out of the grid, out of search and out of the ' +
          'mega-menu, because `PUBLISHED_PRODUCT` requires the category to be active; switching a ' +
          'parent off takes its sub-categories with it in the same transaction, and the audit ' +
          'entry names them.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminCategoryActiveInput,
        response: {
          200: AdminCategoryList,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    (request) =>
      setCategoryActive(
        app.db,
        request.params.id,
        request.body.isActive,
        adminActor(request),
        auditContext(request),
      ),
  );

  routes.post(
    '/categories/:id/image',
    {
      onRequest: app.requirePermission('products:write'),
      schema: {
        tags: ['admin'],
        summary: 'Upload a category hero image',
        description:
          'multipart/form-data, one file, through the same pipeline a product photograph takes: ' +
          're-encoded to a capped webp, metadata stripped, keyed by content hash. Replacing one ' +
          'removes the old object after the row is written, best-effort.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        // The body is multipart, not JSON, so no body schema; the parser reads the file below.
        response: {
          200: AdminCategoryList,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          413: ApiError,
          422: ApiError,
        },
      },
    },
    async (request) => {
      const file = await request.file();
      if (!file) throw new AppError('VALIDATION_FAILED', 'No file was uploaded');

      return setCategoryImage(
        app.db,
        app.storage,
        request.params.id,
        await file.toBuffer(),
        adminActor(request),
        auditContext(request),
      );
    },
  );

  routes.delete(
    '/categories/:id/image',
    {
      onRequest: app.requirePermission('products:write'),
      schema: {
        tags: ['admin'],
        summary: 'Remove a category’s hero image',
        description:
          'The category page falls back to its gradient, which is what it does before an image is ' +
          'ever uploaded. There is no way to type a URL back in - see the create route.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: { 200: AdminCategoryList, 401: ApiError, 403: ApiError, 404: ApiError },
      },
    },
    (request) =>
      clearCategoryImage(
        app.db,
        app.storage,
        request.params.id,
        adminActor(request),
        auditContext(request),
      ),
  );

  // ---------------------------------------------------------------------------------- orders

  routes.get(
    '/orders',
    {
      onRequest: app.requirePermission('orders:read'),
      schema: {
        tags: ['admin'],
        summary: 'The order list',
        description:
          '`q` matches an order number or an email, which is what a customer quotes when they ' +
          'write in. `needsFulfilment` is the shipping desk’s queue - paid and processing ' +
          'together - which a single status filter cannot express.',
        security: [{ bearerAuth: [] }],
        querystring: AdminOrderListQuery,
        response: { 200: AdminOrderListResponse, 401: ApiError, 403: ApiError, 422: ApiError },
      },
    },
    (request) => listAdminOrders(app.db, request.query),
  );

  routes.get(
    '/orders/:orderNumber',
    {
      onRequest: app.requirePermission('orders:read'),
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
        response: {
          200: AdminOrderDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => getAdminOrder(app.db, request.params.orderNumber, adminActor(request).role),
  );

  routes.patch(
    '/orders/:orderNumber/status',
    {
      onRequest: app.requirePermission('orders:write'),
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
          403: ApiError,
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
        adminActor(request),
        auditContext(request),
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
      onRequest: app.requirePermission('orders:write'),
      schema: {
        tags: ['admin'],
        summary: 'Correct the tracking details without touching the status',
        description:
          'Separate from the status change because the common use is fixing a mistyped number on ' +
          'an order that already shipped, and re-shipping it to do so would send a second notice.',
        security: [{ bearerAuth: [] }],
        params: OrderNumberParams,
        body: AdminTrackingInput,
        response: {
          200: AdminOrderDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) =>
      setTracking(
        app.db,
        request.params.orderNumber,
        request.body,
        adminActor(request),
        auditContext(request),
      ),
  );

  routes.put(
    '/orders/:orderNumber/note',
    {
      onRequest: app.requirePermission('orders:write'),
      schema: {
        tags: ['admin'],
        summary: 'The internal note',
        description:
          'Never serialised to a storefront response - `OrderView` has no field for it. This is ' +
          'where staff write things a customer must not read.',
        security: [{ bearerAuth: [] }],
        params: OrderNumberParams,
        body: AdminOrderNoteInput,
        response: {
          200: AdminOrderDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) =>
      setAdminNote(
        app.db,
        request.params.orderNumber,
        request.body.adminNote,
        adminActor(request),
        auditContext(request),
      ),
  );

  // ----------------------------------------------------------------------------------- audit

  routes.get(
    '/audit',
    {
      onRequest: app.requirePermission('audit:read'),
      schema: {
        tags: ['admin'],
        summary: 'What administrators have done',
        description:
          'Keyset on the id, newest first, and deliberately not offset - a departure from D-25, ' +
          'which chose offset for the numbered pages the catalogue mockup showed and for a ' +
          '`MIN(price)` sort keyset cannot serve. Neither applies here: nobody asks for page nine ' +
          'of an audit log, the sort is the primary key, and the table only grows, so an offset ' +
          'scan gets slower every week while a seek does not. There is no total for the same ' +
          'reason. The list carries the names of the fields that moved, not their values; the ' +
          'values come with the detail.',
        security: [{ bearerAuth: [] }],
        querystring: AdminAuditQuery,
        response: { 200: AdminAuditResponse, 401: ApiError, 403: ApiError, 422: ApiError },
      },
    },
    (request) => listAudit(app.db, request.query),
  );

  routes.get(
    '/audit/actors',
    {
      onRequest: app.requirePermission('audit:read'),
      schema: {
        tags: ['admin'],
        summary: 'Who appears in the log',
        description:
          'Drawn from the log rather than from `admin_users`, because the useful list is the ' +
          'people who have done something - including those whose accounts have since been ' +
          'deleted, which the team list by definition cannot show. Grouped on id and copied name ' +
          'together, so a renamed account shows both names it acted under.',
        security: [{ bearerAuth: [] }],
        response: { 200: AdminAuditActors, 401: ApiError, 403: ApiError },
      },
    },
    () => listAuditActors(app.db),
  );

  routes.get(
    '/audit/:id',
    {
      onRequest: app.requirePermission('audit:read'),
      schema: {
        tags: ['admin'],
        summary: 'One entry, with what actually changed',
        description:
          'Served on expand, which is what keeps the list page from shipping every payload it ' +
          'can see. This is also the only place `ip` and `userAgent` are returned.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          200: AdminAuditEntry,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => getAuditEntry(app.db, request.params.id),
  );

  // ------------------------------------------------------------------------------------ team

  /**
   * `requireFreshPermission`, not `requirePermission`.
   *
   * Every other permission merely delays inside the fifteen-minute token window - a demoted manager
   * keeps manager powers until the token expires, which is the bargain a short-lived stateless
   * token exists to make. `team:manage` breaks that bargain: inside the window a demoted owner
   * could create a second owner account and undo their own demotion permanently. So these four
   * re-read `admin_users` on every request and the window is zero (D-32).
   */
  routes.get(
    '/team',
    {
      onRequest: app.requireFreshPermission('team:manage'),
      schema: {
        tags: ['admin'],
        summary: 'Every administrator, deactivated ones included',
        description:
          'Unlike `GET /users` - the assignee picker, which lists only accounts that can be given ' +
          'work - this screen exists to manage the ones that cannot. No response here carries a ' +
          'password hash: `AdminTeamMember` has no field for one.',
        security: [{ bearerAuth: [] }],
        response: { 200: AdminTeamList, 401: ApiError, 403: ApiError },
      },
    },
    () => listTeam(app.db),
  );

  routes.post(
    '/team',
    {
      onRequest: app.requireFreshPermission('team:manage'),
      schema: {
        tags: ['admin'],
        summary: 'Add an administrator',
        description:
          'The owner sets the initial password. There is no email invite: that needs a token ' +
          'table, an expiry, a public accept page and mail delivery - a feature, not a guard - ' +
          'and without an owner who can set one, a forgotten password is unrecoverable without ' +
          'SQL, because the email is unique and the account cannot simply be recreated.',
        security: [{ bearerAuth: [] }],
        body: AdminTeamCreateInput,
        response: {
          201: AdminTeamMember,
          401: ApiError,
          403: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    async (request, reply) => {
      const created = await createTeamMember(
        app.db,
        request.body,
        adminActor(request),
        auditContext(request),
      );
      return reply.status(201).send(created);
    },
  );

  routes.patch(
    '/team/:id',
    {
      onRequest: app.requireFreshPermission('team:manage'),
      schema: {
        tags: ['admin'],
        summary: 'Rename, re-role or retire an administrator',
        description:
          'Three 409s guard the same failure - an owner locking the shop out of its own back ' +
          'office. An owner may not change their own role, may not deactivate themselves, and no ' +
          'change may leave zero active owners. There is no DELETE at any role: deleting an ' +
          'account nulls its audit entries, orphans the wholesale notes it wrote and empties the ' +
          'enquiries it was assigned. Reducing somebody’s authority revokes their sessions; ' +
          'promoting them does not.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminTeamUpdateInput,
        response: {
          200: AdminTeamMember,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    (request) =>
      updateTeamMember(
        app.db,
        request.params.id,
        request.body,
        adminActor(request),
        auditContext(request),
      ),
  );

  routes.patch(
    '/team/:id/password',
    {
      onRequest: app.requireFreshPermission('team:manage'),
      schema: {
        tags: ['admin'],
        summary: 'Reset an administrator’s password',
        description:
          'Somebody else’s, never your own - that goes through the account, which asks for the ' +
          'current password. Always revokes the target’s sessions, so a password changed because ' +
          'it may have leaked also ends every session it may have leaked into.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminTeamPasswordInput,
        response: {
          204: z.null(),
          401: ApiError,
          403: ApiError,
          404: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    async (request, reply) => {
      await resetTeamPassword(
        app.db,
        request.params.id,
        request.body.password,
        adminActor(request),
        auditContext(request),
      );
      return reply.status(204).send();
    },
  );

  // ------------------------------------------------------------------------------- wholesale

  routes.get(
    '/wholesale/requests',
    {
      onRequest: app.requirePermission('wholesale:read'),
      schema: {
        tags: ['admin'],
        summary: 'Wholesale enquiries',
        description:
          '`unassigned` is the queue that actually needs somebody: enquiries nobody has taken. ' +
          '`submittedIp` is stored by the public form and never returned here - it exists for ' +
          'investigating a flood of junk, not for printing beside a business name.',
        security: [{ bearerAuth: [] }],
        querystring: AdminWholesaleListQuery,
        response: { 200: AdminWholesaleListResponse, 401: ApiError, 403: ApiError, 422: ApiError },
      },
    },
    (request) => listWholesaleRequests(app.db, request.query),
  );

  routes.get(
    '/wholesale/requests/:id',
    {
      onRequest: app.requirePermission('wholesale:read'),
      schema: {
        tags: ['admin'],
        summary: 'One enquiry, with its note thread',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          200: AdminWholesaleDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => getWholesaleRequest(app.db, request.params.id),
  );

  routes.patch(
    '/wholesale/requests/:id',
    {
      onRequest: app.requirePermission('wholesale:write'),
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
        response: {
          200: AdminWholesaleDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) =>
      triageWholesaleRequest(
        app.db,
        request.params.id,
        request.body,
        adminActor(request),
        auditContext(request),
      ),
  );

  routes.post(
    '/wholesale/requests/:id/notes',
    {
      onRequest: app.requirePermission('wholesale:write'),
      schema: {
        tags: ['admin'],
        summary: 'Append a note to the thread',
        description:
          'Append-only, and stamped with the author’s name copied into the row: a note has to ' +
          'keep saying who wrote it after that account is removed.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: AdminWholesaleNoteInput,
        response: {
          201: AdminWholesaleDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    async (request, reply) => {
      const detail = await addWholesaleNote(
        app.db,
        request.params.id,
        adminActor(request).id,
        request.body.body,
      );
      return reply.status(201).send(detail);
    },
  );

  // ------------------------------------------------------------------------------- customers

  routes.get(
    '/customers',
    {
      onRequest: app.requirePermission('customers:read'),
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
        response: { 200: AdminCustomerListResponse, 401: ApiError, 403: ApiError, 422: ApiError },
      },
    },
    (request) => listCustomers(app.db, request.query),
  );

  routes.get(
    '/customers/:id',
    {
      onRequest: app.requirePermission('customers:read'),
      schema: {
        tags: ['admin'],
        summary: 'One customer, with their ten most recent orders',
        description:
          'The saved addresses and the session list are deliberately absent: an address is the ' +
          'customer’s own and the order already carries the one it shipped to, and a ' +
          'refresh token is a credential.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          200: AdminCustomerDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => getCustomer(app.db, request.params.id),
  );

  routes.patch(
    '/customers/:id/status',
    {
      // The first route in the panel to need more than a session. Suspending somebody is the kind
      // of thing a support account should not be able to do alone.
      onRequest: app.requirePermission('customers:block'),
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
    (request) =>
      setCustomerStatus(
        app.db,
        request.params.id,
        request.body.status,
        adminActor(request),
        auditContext(request),
      ),
  );

  // --------------------------------------------------------------------------------- pricing

  routes.post(
    '/pricing/preview',
    {
      onRequest: app.requirePermission('pricing:bulk'),
      schema: {
        tags: ['admin'],
        summary: 'Compute every row a bulk price operation would touch, and write nothing',
        description:
          'The read half of the two-step machine. Each row carries a verdict - change, unchanged ' +
          'or blocked - and a blocked row names why (a price at or below zero, a compare-at no ' +
          'longer above the price, a sale on a variant already on sale) so it can be deselected ' +
          'rather than surfacing as a 500 mid-batch. A scope matching more than the batch ceiling ' +
          'is a 422, not a truncated list.',
        security: [{ bearerAuth: [] }],
        body: AdminPricePreviewInput,
        response: { 200: AdminPricePreview, 401: ApiError, 403: ApiError, 422: ApiError },
      },
    },
    (request) => previewPricing(app.db, request.body),
  );

  routes.post(
    '/pricing/apply',
    {
      onRequest: app.requirePermission('pricing:bulk'),
      schema: {
        tags: ['admin'],
        summary: 'Apply a bulk price operation to the confirmed rows',
        description:
          'All rows or none, in one transaction with the affected rows locked in id order. Each ' +
          'row carries the price the operator saw as a precondition; the server recomputes from ' +
          'its own locked row and never writes a figure the client sent. A row that drifted since ' +
          'the preview, one that recomputes to blocked, or one that would sell under cost without ' +
          '`allowBelowCost`, refuses the whole batch - there is no audit log yet, so a partial ' +
          'apply would be unrecoverable.',
        security: [{ bearerAuth: [] }],
        body: AdminPriceApplyInput,
        response: {
          200: AdminPriceApplyResult,
          401: ApiError,
          403: ApiError,
          409: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => applyPricing(app.db, request.body, adminActor(request), auditContext(request)),
  );

  // ---------------------------------------------------------------------------- promo codes

  routes.get(
    '/promos',
    {
      onRequest: app.requirePermission('promos:read'),
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
        response: { 200: AdminPromoListResponse, 401: ApiError, 403: ApiError, 422: ApiError },
      },
    },
    (request) => listPromos(app.db, request.query),
  );

  routes.get(
    '/promos/:id',
    {
      onRequest: app.requirePermission('promos:read'),
      schema: {
        tags: ['admin'],
        summary: 'One code, with its latest redemptions',
        description:
          '`recordedDiscountCents` is what the order wrote down, which is zero for every ' +
          'free-shipping redemption: the waived postage is not stored anywhere, and today’s ' +
          'rate is not the rate it shipped under.',
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          200: AdminPromoDetail,
          401: ApiError,
          403: ApiError,
          404: ApiError,
          422: ApiError,
        },
      },
    },
    (request) => getPromo(app.db, request.params.id),
  );

  routes.post(
    '/promos',
    {
      onRequest: app.requirePermission('promos:write'),
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
    async (request, reply) =>
      reply
        .status(201)
        .send(await createPromo(app.db, request.body, adminActor(request), auditContext(request))),
  );

  routes.put(
    '/promos/:id',
    {
      onRequest: app.requirePermission('promos:write'),
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
    (request) =>
      updatePromo(
        app.db,
        request.params.id,
        request.body,
        adminActor(request),
        auditContext(request),
      ),
  );

  routes.patch(
    '/promos/:id/active',
    {
      onRequest: app.requirePermission('promos:write'),
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
    (request) =>
      setPromoActive(
        app.db,
        request.params.id,
        request.body.isActive,
        adminActor(request),
        auditContext(request),
      ),
  );

  // -------------------------------------------------------------------------------- settings

  routes.get(
    '/settings',
    {
      onRequest: app.requirePermission('settings:read'),
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
        response: { 200: AdminSettings, 401: ApiError, 403: ApiError },
      },
    },
    () => loadSettings(app.db),
  );

  routes.put(
    '/settings',
    {
      onRequest: app.requirePermission('settings:write'),
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
    (request) => saveSettings(app.db, request.body, adminActor(request), auditContext(request)),
  );

  routes.get(
    '/shipping-rates',
    {
      onRequest: app.requirePermission('shipping:read'),
      schema: {
        tags: ['admin'],
        summary: 'The shipping rates on their own',
        description:
          'Split from `GET /settings`, which is owner and manager only: that one is an unfiltered ' +
          'read of a table whose schema comment says a non-public row is where an API key would ' +
          'live (D-31). This is the half a support agent needs - it answers "why was I charged ' +
          'postage" and "when will it arrive", and carries nothing the storefront does not print.',
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(AdminShippingRate), 401: ApiError, 403: ApiError },
      },
    },
    () => loadShippingRates(app.db),
  );

  routes.put(
    '/shipping-rates/:id',
    {
      onRequest: app.requirePermission('settings:write'),
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
    (request) =>
      saveShippingRate(
        app.db,
        request.params.id,
        request.body,
        adminActor(request),
        auditContext(request),
      ),
  );

  routes.get(
    '/users',
    {
      onRequest: app.requirePermission('users:read'),
      schema: {
        tags: ['admin'],
        summary: 'The team, for the assignee picker',
        description:
          'Names and roles only. Inactive accounts are left out: they cannot be given work.',
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(AdminUserOption), 401: ApiError, 403: ApiError },
      },
    },
    () => listAdminUsers(app.db),
  );
}
