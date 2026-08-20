import { z } from 'zod';

import {
  AdminRole,
  BusinessType,
  Certification,
  CustomerStatus,
  NutritionSource,
  OrderStatus,
  Origin,
  PaymentStatus,
  ProductBadge,
  ProductStatus,
  VolumeBand,
  WeightUnit,
  WholesaleStatus,
} from '../enums';
import { PageNumber, paginated } from '../pagination';
import { Cents, Currency, Email, Id, IsoDate, Slug } from '../primitives';

import { AdminProfile, Password } from './auth';
import { QueryBoolean } from './catalog';
import { OrderView } from './order';

/**
 * The back office's read models.
 *
 * Separate from the storefront's schemas even where the shapes look similar, because they answer
 * to different rules: a customer is shown what they are allowed to see, an administrator is shown
 * what they need to act on. `OrderSummary` deliberately carries no email; `AdminOrderRow` does.
 */

/**
 * A figure and the same figure a window earlier.
 *
 * `deltaBasisPoints` is null rather than zero when the previous window was empty: a shop's first
 * month of revenue is not "up 0%", and printing a percentage against nothing is how a dashboard
 * starts lying. The client shows a dash.
 */
export const AdminMetric = z.object({
  current: z.number().int().nonnegative(),
  previous: z.number().int().nonnegative(),
  deltaBasisPoints: z.number().int().nullable(),
});
export type AdminMetric = z.infer<typeof AdminMetric>;

/** One day of the revenue chart. `date` is `YYYY-MM-DD` in the shop's own timezone. */
export const AdminRevenuePoint = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cents: Cents,
});
export type AdminRevenuePoint = z.infer<typeof AdminRevenuePoint>;

/**
 * A variant worth restocking.
 *
 * Out of stock is included and sorts first: it is the most urgent case, and a panel called Low
 * Stock that hid the zeroes would be the wrong way round.
 */
export const AdminLowStockRow = z.object({
  variantId: Id,
  productSlug: Slug,
  productName: z.string(),
  sku: z.string(),
  weightLabel: z.string(),
  stockQty: z.number().int().nonnegative(),
  /** The variant's own threshold, so the bar has something to be a fraction of. */
  lowStockThreshold: z.number().int().nonnegative(),
});
export type AdminLowStockRow = z.infer<typeof AdminLowStockRow>;

/** A row in the admin's order tables. Carries the email, which the customer's view does not. */
export const AdminOrderRow = z.object({
  orderNumber: z.string(),
  email: z.string(),
  /** Null for a guest checkout, which is most of them. */
  customerName: z.string().nullable(),
  status: OrderStatus,
  totalCents: Cents,
  currency: Currency,
  itemCount: z.number().int().nonnegative(),
  createdAt: IsoDate,
});
export type AdminOrderRow = z.infer<typeof AdminOrderRow>;

/**
 * The order list's filters.
 *
 * `q` matches an order number or an email, which is what an operator has in front of them when a
 * customer writes in. `needsFulfilment` is the working queue - paid and processing together, the
 * orders somebody has to do something about - because that is the view a shipping desk lives in and
 * it is two statuses, not one, so a plain status filter cannot express it.
 */
export const AdminOrderListQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.union([OrderStatus, z.literal('all')]).default('all'),
    needsFulfilment: QueryBoolean.optional(),
    page: PageNumber.default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type AdminOrderListQuery = z.infer<typeof AdminOrderListQuery>;

export const AdminOrderListResponse = paginated(AdminOrderRow);
export type AdminOrderListResponse = z.infer<typeof AdminOrderListResponse>;

/**
 * One order, everything the back office acts on.
 *
 * Built by extending the storefront's `OrderView` rather than restating it, so the two cannot
 * describe the same order differently. What the admin adds is what a customer must never see: the
 * internal note, the payment's provider id, and `allowedTransitions` - the statuses this order may
 * move to next, computed on the server from `ORDER_STATUS_TRANSITIONS`.
 *
 * `refunded` never appears in `allowedTransitions`, even though the transition map allows it. A
 * refund is money leaving the account, and it is recorded when the provider says it happened
 * (the `charge.refunded` webhook, already built). An admin button that wrote `refunded` locally
 * would state that a customer had been paid back when nothing had left the account.
 */
export const AdminOrderDetail = OrderView.extend({
  id: Id,
  customerId: Id.nullable(),
  customerName: z.string().nullable(),
  adminNote: z.string().nullable(),
  /** What a person may move this order to now. Empty for a finished order. */
  allowedTransitions: z.array(OrderStatus),
  payment: OrderView.shape.payment
    .unwrap()
    .extend({
      status: PaymentStatus,
      /** The provider's own id, which is what a support conversation with them starts from. */
      providerPaymentId: z.string(),
      amountCents: Cents,
      refundedCents: Cents,
    })
    .nullable(),
  cancelledAt: IsoDate.nullable(),
  refundedAt: IsoDate.nullable(),
  updatedAt: IsoDate,
});
export type AdminOrderDetail = z.infer<typeof AdminOrderDetail>;

/**
 * A status change, with the tracking details that usually accompany one.
 *
 * Carrier and tracking ride along because the moment an operator marks an order shipped is the
 * moment they have the tracking number in hand; making it a second request would mean a customer
 * receiving a "your order shipped" email with nothing to follow. They are optional rather than
 * required - a local hand-delivery has no tracking number, and inventing one to satisfy a form is
 * worse than an order without.
 */
export const AdminOrderStatusInput = z
  .object({
    status: OrderStatus,
    carrier: z.string().trim().min(1).max(60).optional(),
    trackingNumber: z.string().trim().min(1).max(120).optional(),
    trackingUrl: z.string().url().max(500).optional(),
    /** Appended to the internal note, so why an order was cancelled survives the person. */
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type AdminOrderStatusInput = z.infer<typeof AdminOrderStatusInput>;

/** Tracking details on their own, for the common case of correcting a typo in a number. */
export const AdminTrackingInput = z
  .object({
    carrier: z.string().trim().min(1).max(60).nullable(),
    trackingNumber: z.string().trim().min(1).max(120).nullable(),
    trackingUrl: z.string().url().max(500).nullable(),
  })
  .strict();
export type AdminTrackingInput = z.infer<typeof AdminTrackingInput>;

/** The internal note, replaced wholesale. Never serialised to a storefront response. */
export const AdminOrderNoteInput = z.object({ adminNote: z.string().max(4000) }).strict();
export type AdminOrderNoteInput = z.infer<typeof AdminOrderNoteInput>;

// --------------------------------------------------------------------------------------
// Promo codes
// --------------------------------------------------------------------------------------

/**
 * What a promo code takes off, as a shape the wrong pairing cannot express.
 *
 * `promo_codes.value` is one integer column with three meanings - basis points for `percent`, cents
 * for `fixed`, read by nothing for `free_shipping` - so the contract never transports it as a bare
 * `value`. A discriminated union makes "a percentage of 1299 cents" unrepresentable rather than
 * merely refused, and it is why changing a live code's type is safe: the payload cannot restate the
 * type without restating the amount in the right unit.
 *
 * `maxDiscountCents` lives inside the `percent` member alone. `discountFor` applies the cap to
 * whatever produced the raw figure, fixed codes included, so a $20 fixed code capped at $5 would
 * have the panel printing $20 and the cart taking off $5.
 */
export const AdminPromoDiscount = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('percent'),
      /** Basis points: 1000 is ten per cent. A whole column of them beats a decimal. */
      basisPoints: z.number().int().min(1).max(10_000),
      /** Blank is uncapped. A cap of nothing is not a cap - it takes nothing off. */
      maxDiscountCents: Cents.refine((value) => value > 0, 'A cap of nothing is no cap').nullable(),
    })
    .strict(),
  // `.strict()` on every member, so a `maxDiscountCents` sent alongside a `fixed` code is a 422
  // rather than a silent strip: `discountFor` applies the cap to fixed codes too, so a stripped
  // one would have the panel and the cart disagreeing about the discount.
  z
    .object({
      type: z.literal('fixed'),
      // The signed INT's own capacity, which invents no business rule: past it MySQL raises
      // ER_WARN_DATA_OUT_OF_RANGE, which the error handler has no case for and returns as a 500.
      // `.max` before `.refine`: a refine returns ZodEffects, which has no numeric methods left.
      amountCents: Cents.max(2_147_483_647).refine(
        (value) => value > 0,
        'A code that takes off nothing',
      ),
    })
    .strict(),
  z.object({ type: z.literal('free_shipping') }).strict(),
]);
export type AdminPromoDiscount = z.infer<typeof AdminPromoDiscount>;

/**
 * Where a code stands, derived on every read and never stored.
 *
 * The precedence mirrors `applyPromo`'s branch order exactly - disabled, scheduled, expired,
 * exhausted, live - because the chip has to name the same blocking condition the customer is being
 * told about. A third rule, however sensible on its own, would be a third answer to one question.
 */
export const PROMO_STATE = ['disabled', 'scheduled', 'expired', 'exhausted', 'live'] as const;
export const PromoState = z.enum(PROMO_STATE);
export type PromoState = z.infer<typeof PromoState>;

export const AdminPromoRow = z.object({
  id: Id,
  code: z.string(),
  description: z.string().nullable(),
  discount: AdminPromoDiscount,
  minOrderCents: Cents,
  usageLimit: z.number().int().positive().nullable(),
  usageLimitPerCustomer: z.number().int().positive().nullable(),
  /** An accounting fact, incremented by the paid transaction. Never writable, at any endpoint. */
  usedCount: z.number().int().nonnegative(),
  startsAt: IsoDate.nullable(),
  endsAt: IsoDate.nullable(),
  isActive: z.boolean(),
  state: PromoState,
  createdAt: IsoDate,
});
export type AdminPromoRow = z.infer<typeof AdminPromoRow>;

export const AdminPromoListQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    state: z.union([PromoState, z.literal('all')]).default('all'),
    page: PageNumber.default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type AdminPromoListQuery = z.infer<typeof AdminPromoListQuery>;

export const AdminPromoListResponse = paginated(AdminPromoRow);
export type AdminPromoListResponse = z.infer<typeof AdminPromoListResponse>;

/** One redemption, as the detail page lists them. */
export const AdminPromoRedemption = z.object({
  orderNumber: z.string(),
  email: z.string(),
  /**
   * What the order actually recorded. Zero for every `free_shipping` redemption, because
   * `discountFor` returns zero for that type and the order copies it - the waived postage is not
   * written down anywhere. The panel prints a dash rather than "$0.00", and BACKLOG.md holds the
   * item that would make the figure real.
   */
  recordedDiscountCents: Cents,
  createdAt: IsoDate,
});
export type AdminPromoRedemption = z.infer<typeof AdminPromoRedemption>;

export const AdminPromoDetail = AdminPromoRow.extend({
  /**
   * False once any order has ever named this code, at any status.
   *
   * `orders.promo_code` is a varchar snapshot and the paid transaction looks the code up by that
   * string. Renaming a used code reattributes history, and worse: a pending order priced under the
   * old name reaches the webhook, finds no row, and takes the "no such promo" branch - the payment
   * succeeds and the redemption is never recorded, so a per-customer limit stops binding.
   */
  canRenameCode: z.boolean(),
  /** How many rows exist, so "the latest twenty of a hundred and thirty-seven" can be honest. */
  redemptionCount: z.number().int().nonnegative(),
  redemptions: z.array(AdminPromoRedemption),
  updatedAt: IsoDate,
});
export type AdminPromoDetail = z.infer<typeof AdminPromoDetail>;

/**
 * The editable fields, declared once.
 *
 * `usedCount` is absent and `.strict()` turns an attempt to send it into a 422 rather than a
 * discard. It is not an editorial field: making it writable is a way to make the usage limit lie in
 * both directions with no record - set it to zero and a hundred-use campaign gives away two
 * hundred. The honest lever is `usageLimit`, which means exactly one thing.
 */
export const AdminPromoFields = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(32)
      .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Letters, digits and hyphens only'),
    description: z.string().trim().max(200).nullable(),
    discount: AdminPromoDiscount,
    minOrderCents: Cents,
    usageLimit: z.number().int().positive().max(2_147_483_647).nullable(),
    usageLimitPerCustomer: z.number().int().positive().max(2_147_483_647).nullable(),
    startsAt: IsoDate.nullable(),
    endsAt: IsoDate.nullable(),
    isActive: z.boolean(),
  })
  .strict();

/**
 * The two cross-field rules, declared once and applied to both input schemas.
 *
 * Predicates rather than a generic wrapper: a helper taking `z.ZodTypeAny` widens the object it is
 * handed to an index signature, and the inferred payload stops naming its own fields.
 */
interface PromoWindow {
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usageLimitPerCustomer: number | null;
}

const windowIsOrdered = (value: PromoWindow): boolean =>
  value.startsAt === null || value.endsAt === null || value.endsAt > value.startsAt;

const WINDOW_MESSAGE = { message: 'The window ends before it starts', path: ['endsAt'] };

/**
 * "Each person may use this ten times" on a code usable five times in total is a limit that can
 * never bind - not an error the cart would ever hit, which is exactly why nobody would find it.
 */
const limitsAgree = (value: PromoWindow): boolean =>
  value.usageLimit === null ||
  value.usageLimitPerCustomer === null ||
  value.usageLimitPerCustomer <= value.usageLimit;

const LIMITS_MESSAGE = {
  message: 'A per-customer limit above the total limit can never bind',
  path: ['usageLimitPerCustomer'],
};

export const AdminPromoInput = AdminPromoFields.refine(windowIsOrdered, WINDOW_MESSAGE).refine(
  limitsAgree,
  LIMITS_MESSAGE,
);
export type AdminPromoInput = z.infer<typeof AdminPromoInput>;

/**
 * The same fields without `isActive`, for a full-replace update.
 *
 * A PUT carrying it would let a stale edit form silently revert the kill switch somebody threw
 * while the form was open. Turning a code on and off is its own small endpoint.
 */
export const AdminPromoUpdateInput = AdminPromoFields.omit({ isActive: true })
  .refine(windowIsOrdered, WINDOW_MESSAGE)
  .refine(limitsAgree, LIMITS_MESSAGE);
export type AdminPromoUpdateInput = z.infer<typeof AdminPromoUpdateInput>;

export const AdminPromoActiveInput = z.object({ isActive: z.boolean() }).strict();
export type AdminPromoActiveInput = z.infer<typeof AdminPromoActiveInput>;

// --------------------------------------------------------------------------------------
// Customers
// --------------------------------------------------------------------------------------

/**
 * A row in the customer list.
 *
 * `name` is joined on the server, as `AdminWholesaleRow.contactName` is, so two screens cannot
 * print one person's name two ways. `orderCount` counts every order and `lifetimeSpentCents` only
 * the `EARNED_ORDER_STATUS` four - the same deliberate asymmetry the customer's own account page
 * uses, so the panel and the account card agree to the cent.
 *
 * People who only ever checked out as a guest are absent, because there is no row to show. A guest
 * order carries an email and no `customer_id`, and grouping orders by email to manufacture a
 * customer would assert exactly the identity the checkout declines to assert.
 */
export const AdminCustomerRow = z.object({
  id: Id,
  email: z.string(),
  name: z.string(),
  status: CustomerStatus,
  orderCount: z.number().int().nonnegative(),
  lifetimeSpentCents: Cents,
  currency: Currency,
  lastOrderAt: IsoDate.nullable(),
  createdAt: IsoDate,
});
export type AdminCustomerRow = z.infer<typeof AdminCustomerRow>;

export const AdminCustomerListQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.union([CustomerStatus, z.literal('all')]).default('all'),
    /** "Who are my best customers" is the one question no other screen answers. */
    sort: z.enum(['newest', 'spend']).default('newest'),
    page: PageNumber.default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type AdminCustomerListQuery = z.infer<typeof AdminCustomerListQuery>;

export const AdminCustomerListResponse = paginated(AdminCustomerRow);
export type AdminCustomerListResponse = z.infer<typeof AdminCustomerListResponse>;

/**
 * One customer.
 *
 * `recentOrders` reuses `AdminOrderRow`, so the customer's orders and the order list cannot
 * describe one order two ways.
 *
 * What is deliberately absent: the password hash, obviously; the saved addresses, because an
 * address is the customer's own and reading one answers no operational question the order's own
 * shipping address does not; and the session list, because a refresh token is a credential.
 */
export const AdminCustomerDetail = AdminCustomerRow.extend({
  phone: z.string().nullable(),
  /** Read-only: consent is the customer's to give, and there is no system that acts on it yet. */
  marketingOptIn: z.boolean(),
  lastLoginAt: IsoDate.nullable(),
  recentOrders: z.array(AdminOrderRow),
  updatedAt: IsoDate,
});
export type AdminCustomerDetail = z.infer<typeof AdminCustomerDetail>;

/**
 * The one thing an administrator may change about a customer.
 *
 * Everything an admin panel usually grows here - change the email, reset the password, edit the
 * name, toggle marketing consent - either manufactures a fact only the customer can create or
 * opens an account-takeover path. They are in `BACKLOG.md` with the reason.
 */
export const AdminCustomerStatusInput = z.object({ status: CustomerStatus }).strict();
export type AdminCustomerStatusInput = z.infer<typeof AdminCustomerStatusInput>;

// --------------------------------------------------------------------------------------
// The team
// --------------------------------------------------------------------------------------

/**
 * One administrator, as the owner's Team screen reads them.
 *
 * Extends `AdminProfile` - the shape the signed-in admin already receives about themselves - rather
 * than restating it, so one account cannot be described two ways. What it adds is what only this
 * screen needs: whether the account is still active, and when it was created.
 *
 * There is no `passwordHash` field, so the serialiser cannot emit one even if the service hands it
 * a whole row. That is the same reason `AdminCustomerDetail` has no session list.
 */
export const AdminTeamMember = AdminProfile.extend({
  isActive: z.boolean(),
  createdAt: IsoDate,
});
export type AdminTeamMember = z.infer<typeof AdminTeamMember>;

/**
 * The whole team, deactivated accounts included.
 *
 * Unlike `AdminUserOption` - the assignee picker, which lists only accounts that can be given work
 * - this screen exists to manage the ones that cannot. A wrapped object rather than a bare array,
 * so the response can grow a field without becoming a different shape.
 */
export const AdminTeamList = z.object({ members: z.array(AdminTeamMember) });
export type AdminTeamList = z.infer<typeof AdminTeamList>;

/**
 * A new administrator.
 *
 * The owner sets the initial password. There is no email invite: that needs a token table, an
 * expiry, a public accept page and mail delivery - a feature, not a guard - and without an owner
 * who can set one, a forgotten password is unrecoverable without SQL, because the email is unique
 * and the account cannot simply be recreated. Reset-by-email is in `BACKLOG.md`.
 *
 * `Password` is the same policy customers get, stated once. `.strict()` turns an attempt to post
 * `isActive: false` or a `passwordHash` into a 422 at the type provider rather than something the
 * service has to think about.
 */
export const AdminTeamCreateInput = z
  .object({
    email: Email,
    name: z.string().trim().min(1).max(120),
    role: AdminRole,
    password: Password,
  })
  .strict();
export type AdminTeamCreateInput = z.infer<typeof AdminTeamCreateInput>;

/**
 * What may be changed about an existing account.
 *
 * Email is deliberately absent: it is the login identity and the unique key, and changing it moves
 * an account somebody may be trying to sign in to. Password is absent too - it is a credential, and
 * it must not ride along in a form that also renames somebody.
 */
export const AdminTeamUpdateInput = z
  .object({
    name: AdminTeamCreateInput.shape.name.optional(),
    role: AdminRole.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change');
export type AdminTeamUpdateInput = z.infer<typeof AdminTeamUpdateInput>;

/**
 * An owner resetting somebody else's password.
 *
 * Derived by `.pick()` so the policy cannot drift between creating an account and resetting it. No
 * `currentPassword`: this is the owner resetting a password they do not know, which is the entire
 * point of it existing.
 */
export const AdminTeamPasswordInput = AdminTeamCreateInput.pick({ password: true });
export type AdminTeamPasswordInput = z.infer<typeof AdminTeamPasswordInput>;

// --------------------------------------------------------------------------------------
// Wholesale enquiries
// --------------------------------------------------------------------------------------

/** A row in the enquiry list: enough to triage without opening it. */
export const AdminWholesaleRow = z.object({
  id: Id,
  businessName: z.string(),
  businessType: BusinessType,
  contactName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  monthlyVolumeBand: VolumeBand,
  status: WholesaleStatus,
  /** Who is dealing with it, or null while nobody has taken it. */
  assignedToName: z.string().nullable(),
  noteCount: z.number().int().nonnegative(),
  createdAt: IsoDate,
});
export type AdminWholesaleRow = z.infer<typeof AdminWholesaleRow>;

export const AdminWholesaleListQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.union([WholesaleStatus, z.literal('all')]).default('all'),
    /** Only the ones nobody has taken - the queue that actually needs a person. */
    unassigned: QueryBoolean.optional(),
    page: PageNumber.default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type AdminWholesaleListQuery = z.infer<typeof AdminWholesaleListQuery>;

export const AdminWholesaleListResponse = paginated(AdminWholesaleRow);
export type AdminWholesaleListResponse = z.infer<typeof AdminWholesaleListResponse>;

/**
 * One note on an enquiry.
 *
 * `authorName` is a copy rather than a join, as the column is: a note has to keep saying who wrote
 * it after that person's account is removed, and `admin_user_id` going null must not erase the
 * record of who said what.
 */
export const AdminWholesaleNote = z.object({
  id: Id,
  authorName: z.string(),
  body: z.string(),
  createdAt: IsoDate,
});
export type AdminWholesaleNote = z.infer<typeof AdminWholesaleNote>;

/**
 * One enquiry in full.
 *
 * `submittedIp` is stored and deliberately absent here. It exists for investigating a flood of
 * junk submissions, which is a database question, not something a panel should print next to
 * somebody's business name.
 */
export const AdminWholesaleDetail = AdminWholesaleRow.extend({
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  categoriesOfInterest: z.array(z.string()),
  notes: z.string().nullable(),
  assignedToId: Id.nullable(),
  thread: z.array(AdminWholesaleNote),
  updatedAt: IsoDate,
});
export type AdminWholesaleDetail = z.infer<typeof AdminWholesaleDetail>;

/**
 * Triage: the status, and who owns it.
 *
 * Both optional and both in one call, because they change together - taking an enquiry and marking
 * it contacted is one action to the person doing it. `assignedToId: null` explicitly hands it back
 * to the pool, which is why the field is nullable rather than merely absent.
 */
export const AdminWholesaleTriageInput = z
  .object({
    status: WholesaleStatus.optional(),
    assignedToId: Id.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.status !== undefined || value.assignedToId !== undefined,
    'Nothing to change',
  );
export type AdminWholesaleTriageInput = z.infer<typeof AdminWholesaleTriageInput>;

/** A note added to the thread. Notes are appended and never edited: it is a record, not a draft. */
export const AdminWholesaleNoteInput = z
  .object({ body: z.string().trim().min(1).max(4000) })
  .strict();
export type AdminWholesaleNoteInput = z.infer<typeof AdminWholesaleNoteInput>;

/** The team, for the assignee picker. Nothing here is sensitive; it is a staff list. */
export const AdminUserOption = z.object({
  id: Id,
  name: z.string(),
  role: AdminRole,
});
export type AdminUserOption = z.infer<typeof AdminUserOption>;

// --------------------------------------------------------------------------------------
// Products
// --------------------------------------------------------------------------------------

/**
 * A row in the admin's product list.
 *
 * Carries what an editor scans for and nothing they would have to open the product to see:
 * whether it is live, how many variants it has, what the cheapest one costs, how much stock is
 * left across all of them, and whether its nutrition panel is real or the seed's reference values.
 */
export const AdminProductRow = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  status: ProductStatus,
  categoryName: z.string(),
  imageUrl: z.string().url().nullable(),
  variantCount: z.number().int().nonnegative(),
  /** Null when the product has no active variant, which is how a draft usually starts. */
  priceFromCents: Cents.nullable(),
  stockTotal: z.number().int().nonnegative(),
  isFeatured: z.boolean(),
  /** Absent means no panel at all; otherwise where the figures came from. See decision D-20. */
  nutritionSource: NutritionSource.nullable(),
  updatedAt: IsoDate,
});
export type AdminProductRow = z.infer<typeof AdminProductRow>;

/**
 * The list's filters.
 *
 * `status` accepts `all` rather than being omitted for it, because the default here is not "every
 * status" - an editor opening the list wants the live catalogue first, and a filter that has to be
 * cleared to see drafts is one an editor will forget is on.
 */
export const AdminProductListQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.union([ProductStatus, z.literal('all')]).default('all'),
    category: Slug.optional(),
    /** Products whose stock is at or under a variant's threshold, the dashboard's definition. */
    lowStock: QueryBoolean.optional(),
    page: PageNumber.default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type AdminProductListQuery = z.infer<typeof AdminProductListQuery>;

export const AdminProductListResponse = paginated(AdminProductRow);
export type AdminProductListResponse = z.infer<typeof AdminProductListResponse>;

/**
 * A variant as the form sends it.
 *
 * `id` present means "update this row", absent means "create one". A row the payload leaves out is
 * deleted - and deleting a variant somebody once ordered is safe, because `order_items.variant_id`
 * is `ON DELETE SET NULL` and the line keeps its own snapshot of name, SKU and price.
 *
 * Every physical quantity is a scaled integer (decision D-14): `weightValueMilli` is the value
 * times a thousand, `weightGrams` is what range filters compare. `weightLabel` is the designer's
 * string and the only one a customer reads.
 */
export const AdminVariantInput = z
  .object({
    id: Id.optional(),
    sku: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Letters, digits and hyphens only'),
    weightValueMilli: z.number().int().positive(),
    weightUnit: WeightUnit,
    weightLabel: z.string().trim().min(1).max(40),
    /** Null for a `kit`, which has no single gram weight. The column is nullable for it. */
    weightGrams: z.number().int().nonnegative().nullable().optional(),
    priceCents: Cents.refine((value) => value > 0, 'A variant needs a price'),
    compareAtPriceCents: Cents.nullable().optional(),
    costCents: Cents.nullable().optional(),
    stockQty: z.number().int().nonnegative(),
    lowStockThreshold: z.number().int().nonnegative(),
    position: z.number().int().nonnegative(),
    isDefault: z.boolean(),
    isActive: z.boolean(),
  })
  .strict()
  .refine(
    (variant) =>
      variant.compareAtPriceCents === null ||
      variant.compareAtPriceCents === undefined ||
      variant.compareAtPriceCents > variant.priceCents,
    {
      // A "was" price at or below the current one is not a markdown, it is a mistake that renders
      // as a struck-through number the customer can see is wrong.
      message: 'The compare-at price has to be above the price',
      path: ['compareAtPriceCents'],
    },
  );
export type AdminVariantInput = z.infer<typeof AdminVariantInput>;

/**
 * The Nutrition Facts panel, in the units it is stored in.
 *
 * Milligrams on the wire, not grams. An FDA label is written in grams for the macros and
 * milligrams for sodium, so the form multiplies by a thousand before sending - which keeps
 * fractions out of the request entirely and honours the rule that no business value is a float.
 * `1.5 g` becomes `1500`, exactly, and there is no rounding decision to get wrong on the server.
 *
 * Sending this at all sets the row's `source` to `entered`: the form is the only writer of that
 * value, and the seed's category-level averages stay marked `reference` until someone types over
 * them (decision D-20).
 */
export const AdminNutritionInput = z
  .object({
    servingSize: z.string().trim().min(1).max(60),
    servingsPerContainer: z.number().int().positive().nullable().optional(),
    calories: z.number().int().nonnegative(),
    fatMg: z.number().int().nonnegative(),
    satFatMg: z.number().int().nonnegative(),
    carbsMg: z.number().int().nonnegative(),
    sugarsMg: z.number().int().nonnegative(),
    fiberMg: z.number().int().nonnegative(),
    proteinMg: z.number().int().nonnegative(),
    sodiumMg: z.number().int().nonnegative(),
    ingredientsText: z.string().trim().min(1).max(2000),
    allergensText: z.string().trim().max(400).nullable().optional(),
  })
  .strict()
  .refine((panel) => panel.satFatMg <= panel.fatMg, {
    // Saturated fat is a subset of total fat. A label saying otherwise is a label nobody checked.
    message: 'Saturated fat cannot exceed total fat',
    path: ['satFatMg'],
  })
  .refine((panel) => panel.sugarsMg <= panel.carbsMg, {
    message: 'Sugars cannot exceed total carbohydrates',
    path: ['sugarsMg'],
  });
export type AdminNutritionInput = z.infer<typeof AdminNutritionInput>;

export const AdminProductInput = z
  .object({
    name: z.string().trim().min(2).max(200),
    slug: Slug,
    subtitle: z.string().trim().max(200).nullable().optional(),
    blurb: z.string().trim().min(1).max(300),
    /** NOT NULL in the table: a product page with no description is not a product page. */
    description: z.string().trim().min(1).max(8000),
    story: z.string().trim().max(8000).nullable().optional(),
    categoryId: Id,
    origin: Origin,
    originRegion: z.string().trim().max(160).nullable().optional(),
    status: ProductStatus,
    isFeatured: z.boolean(),
    tone: z.string().trim().max(200).nullable().optional(),
    icon: z.string().trim().max(60).nullable().optional(),
    metaTitle: z.string().trim().max(200).nullable().optional(),
    metaDescription: z.string().trim().max(320).nullable().optional(),

    variants: z.array(AdminVariantInput).min(1).max(20),
    certifications: z.array(Certification).max(5),
    /**
     * Editorial badges only. `sale` and `organic` are never stored (decision D-12): `sale` is
     * exactly "a variant has a compare-at price" and `organic` is exactly "the product carries the
     * organic certification", so storing either would be storing a second answer that can drift.
     */
    badges: z.array(ProductBadge).max(3),
    nutrition: AdminNutritionInput.nullable().optional(),
  })
  .strict()
  .refine((product) => product.variants.filter((variant) => variant.isDefault).length === 1, {
    // The default is what "Add to cart" adds from a grid. Zero leaves the button with nothing to
    // do; two makes the choice arbitrary.
    message: 'Exactly one variant has to be the default',
    path: ['variants'],
  })
  .refine(
    (product) =>
      new Set(product.variants.map((variant) => variant.sku.toUpperCase())).size ===
      product.variants.length,
    { message: 'Two variants cannot share a SKU', path: ['variants'] },
  );
export type AdminProductInput = z.infer<typeof AdminProductInput>;

/** A variant coming back out, with the id the form needs to update it. */
export const AdminVariantView = z.object({
  id: Id,
  sku: z.string(),
  weightValueMilli: z.number().int(),
  weightUnit: WeightUnit,
  weightLabel: z.string(),
  weightGrams: z.number().int().nullable(),
  priceCents: Cents,
  compareAtPriceCents: Cents.nullable(),
  costCents: Cents.nullable(),
  stockQty: z.number().int(),
  lowStockThreshold: z.number().int(),
  position: z.number().int(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});
export type AdminVariantView = z.infer<typeof AdminVariantView>;

/** A product image row, as the admin edits its order and alt text. */
export const AdminProductImage = z.object({
  id: Id,
  url: z.string().url(),
  alt: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  position: z.number().int().nonnegative(),
  isPrimary: z.boolean(),
});
export type AdminProductImage = z.infer<typeof AdminProductImage>;

/**
 * Reordering images and choosing the primary, in one call.
 *
 * The two belong together: the primary is what a card shows, and an editor dragging images into an
 * order is usually deciding which leads. `order` lists every image id exactly once; a request that
 * names a stranger, or forgets one, is rejected whole rather than applied in part.
 */
export const AdminImageArrangement = z
  .object({
    order: z.array(Id).min(1),
    primaryId: Id,
  })
  .strict();
export type AdminImageArrangement = z.infer<typeof AdminImageArrangement>;

/** The alt text an editor types for one image. */
export const AdminImageAltInput = z.object({ alt: z.string().trim().max(300) }).strict();
export type AdminImageAltInput = z.infer<typeof AdminImageAltInput>;

/**
 * One product, everything the form edits.
 *
 * Not the storefront's `ProductDetailResponse`: that one carries derived badges, a review
 * histogram and related products, and carries none of the cost price, the draft status or the
 * nutrition source. Two audiences, two projections.
 */
export const AdminProductDetail = z.object({
  id: Id,
  name: z.string(),
  slug: Slug,
  subtitle: z.string().nullable(),
  blurb: z.string(),
  description: z.string(),
  story: z.string().nullable(),
  categoryId: Id,
  origin: Origin,
  originRegion: z.string().nullable(),
  status: ProductStatus,
  isFeatured: z.boolean(),
  tone: z.string().nullable(),
  icon: z.string().nullable(),
  metaTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  variants: z.array(AdminVariantView),
  certifications: z.array(Certification),
  badges: z.array(ProductBadge),
  images: z.array(AdminProductImage),
  nutrition: AdminNutritionInput.nullable(),
  /** Where the panel's figures came from. Null when there is no panel. */
  nutritionSource: NutritionSource.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type AdminProductDetail = z.infer<typeof AdminProductDetail>;

export const AdminDashboard = z.object({
  /** The window every metric is measured over, so the client states it rather than assuming. */
  windowDays: z.number().int().positive(),
  revenueCents: AdminMetric,
  orderCount: AdminMetric,
  averageOrderCents: AdminMetric,
  newCustomers: AdminMetric,
  currency: Currency,
  revenueSeries: z.array(AdminRevenuePoint),
  lowStock: z.array(AdminLowStockRow),
  recentOrders: z.array(AdminOrderRow),
});
export type AdminDashboard = z.infer<typeof AdminDashboard>;
