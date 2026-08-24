import {
  ADDRESS_TYPE,
  ORDER_STATUS,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  PROMO_TYPE,
  SHIPPING_METHOD,
} from '@silkgrain/contracts';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { productVariants, products } from './catalog';
import { at, createdAt, email, fk, money, pk, position, updatedAt } from './columns';
import { customers } from './customers';

/**
 * Shipping options. Rates live here rather than in configuration because decision D-2 puts
 * them under the admin panel; the seed values come from the mockup.
 */
export const shippingRates = mysqlTable(
  'shipping_rates',
  {
    id: pk(),
    code: mysqlEnum('code', SHIPPING_METHOD).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 200 }),
    priceCents: money('price_cents').notNull(),
    /** Set means orders at or above this subtotal ship free on this method. Null disables it. */
    freeAboveCents: money('free_above_cents'),
    estimatedDaysMin: int('estimated_days_min').notNull(),
    estimatedDaysMax: int('estimated_days_max').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    position: position(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('shipping_rates_code_uq').on(table.code),
    check('shipping_rates_price_nonneg', sql`${table.priceCents} >= 0`),
    check(
      'shipping_rates_days_ordered',
      sql`${table.estimatedDaysMax} >= ${table.estimatedDaysMin}`,
    ),
  ],
);

export const promoCodes = mysqlTable(
  'promo_codes',
  {
    id: pk(),
    code: varchar('code', { length: 32 }).notNull(),
    description: varchar('description', { length: 200 }),
    type: mysqlEnum('type', PROMO_TYPE).notNull(),
    /**
     * Basis points for `percent`, cents for `fixed`, ignored for `free_shipping`.
     * Basis points rather than a percentage so a 12.5 % code needs no decimal column.
     */
    value: int('value').notNull(),
    minOrderCents: money('min_order_cents').notNull().default(0),
    /** Caps how much a percentage code can take off. Null means uncapped. */
    maxDiscountCents: money('max_discount_cents'),
    usageLimit: int('usage_limit'),
    usageLimitPerCustomer: int('usage_limit_per_customer'),
    usedCount: int('used_count').notNull().default(0),
    startsAt: at('starts_at'),
    endsAt: at('ends_at'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('promo_codes_code_uq').on(table.code),
    check('promo_codes_value_nonneg', sql`${table.value} >= 0`),
    check('promo_codes_used_nonneg', sql`${table.usedCount} >= 0`),
    check(
      'promo_codes_window_ordered',
      sql`${table.endsAt} IS NULL OR ${table.startsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`,
    ),

    /**
     * `value` is one column with three meanings, so one range cannot describe it.
     *
     * `promo_codes_value_nonneg` alone permits 50000 on a percent code - five hundred per cent -
     * which `discountFor` then clamps to the subtotal while the panel prints "500% off". These two
     * give each type its own bound. `fixed` stops at the signed INT's own capacity rather than at
     * an invented ceiling: past it, MySQL raises `ER_WARN_DATA_OUT_OF_RANGE`, which reaches the
     * error handler as a 500 with no field named.
     */
    check(
      'promo_codes_percent_range',
      sql`${table.type} <> 'percent' OR ${table.value} BETWEEN 1 AND 10000`,
    ),
    check(
      'promo_codes_fixed_range',
      sql`${table.type} <> 'fixed' OR ${table.value} BETWEEN 1 AND 2147483647`,
    ),

    /** Zero is storable today and means "switched off, obscurely". `is_active` says it plainly. */
    check(
      'promo_codes_limits_positive',
      sql`(${table.usageLimit} IS NULL OR ${table.usageLimit} > 0)
        AND (${table.usageLimitPerCustomer} IS NULL OR ${table.usageLimitPerCustomer} > 0)`,
    ),

    /**
     * The cap belongs to percentages only.
     *
     * `discountFor` applies `max_discount_cents` to whatever `raw` produced, fixed codes included,
     * so a $20 fixed code capped at $5 has the panel printing $20 and the cart taking off $5 -
     * the same class of divergence as a client-supplied price.
     */
    check(
      'promo_codes_cap_percent_only',
      sql`${table.type} = 'percent' OR ${table.maxDiscountCents} IS NULL`,
    ),
  ],
);

export const orders = mysqlTable(
  'orders',
  {
    id: pk(),
    /** `SG-YYYY-NNNNN`, per-year sequence (decision D-3). */
    orderNumber: varchar('order_number', { length: 20 }).notNull(),
    email: email().notNull(),
    /** Null for a guest order. The row survives the customer being deleted. */
    customerId: fk('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    status: mysqlEnum('status', ORDER_STATUS).notNull().default('pending'),

    subtotalCents: money('subtotal_cents').notNull(),
    discountCents: money('discount_cents').notNull().default(0),
    shippingCents: money('shipping_cents').notNull().default(0),
    taxCents: money('tax_cents').notNull().default(0),
    totalCents: money('total_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),

    promoCode: varchar('promo_code', { length: 32 }),
    promoDiscountCents: money('promo_discount_cents').notNull().default(0),
    shippingMethod: mysqlEnum('shipping_method', SHIPPING_METHOD).notNull(),
    carrier: varchar('carrier', { length: 60 }),
    trackingNumber: varchar('tracking_number', { length: 120 }),
    trackingUrl: varchar('tracking_url', { length: 500 }),

    /** Customer-facing note from checkout. */
    customerNote: text('customer_note'),
    /** Internal note, admin only. Never serialised to a storefront response. */
    adminNote: text('admin_note'),

    paidAt: at('paid_at'),
    shippedAt: at('shipped_at'),
    deliveredAt: at('delivered_at'),
    cancelledAt: at('cancelled_at'),
    refundedAt: at('refunded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('orders_number_uq').on(table.orderNumber),
    index('orders_email_idx').on(table.email),
    index('orders_customer_idx').on(table.customerId),
    index('orders_status_idx').on(table.status, table.createdAt),
    /**
     * Renaming a promo code asks "has any order ever named this string", at any status.
     *
     * Without the index that is a full scan of every order the shop has ever taken, run on a
     * keystroke's worth of impatience in the admin form.
     */
    index('orders_promo_code_idx').on(table.promoCode),
    check('orders_totals_nonneg', sql`${table.subtotalCents} >= 0 AND ${table.totalCents} >= 0`),
  ],
);

/**
 * A snapshot, not a join. Name, SKU, weight and unit price are copied at order time and
 * never updated: a price change next month must not rewrite what the customer was charged.
 * The product and variant ids are kept for reporting and go null if the row is ever deleted.
 */
export const orderItems = mysqlTable(
  'order_items',
  {
    id: pk(),
    orderId: fk('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: fk('product_id').references(() => products.id, { onDelete: 'set null' }),
    variantId: fk('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),

    productSlug: varchar('product_slug', { length: 160 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    sku: varchar('sku', { length: 64 }).notNull(),
    weightLabel: varchar('weight_label', { length: 40 }).notNull(),
    imageUrl: varchar('image_url', { length: 500 }),

    unitPriceCents: money('unit_price_cents').notNull(),
    qty: int('qty').notNull(),
    lineTotalCents: money('line_total_cents').notNull(),
    /** This line's share of the order discount, allocated so the lines sum to the total. */
    lineDiscountCents: money('line_discount_cents').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index('order_items_order_idx').on(table.orderId),
    index('order_items_variant_idx').on(table.variantId),
    check('order_items_qty_positive', sql`${table.qty} > 0`),
    check('order_items_price_nonneg', sql`${table.unitPriceCents} >= 0`),
  ],
);

/** Order-scoped addresses. A customer address book is a separate feature, in `BACKLOG.md`. */
export const addresses = mysqlTable(
  'addresses',
  {
    id: pk(),
    orderId: fk('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: mysqlEnum('type', ADDRESS_TYPE).notNull(),
    firstName: varchar('first_name', { length: 80 }).notNull(),
    lastName: varchar('last_name', { length: 80 }).notNull(),
    line1: varchar('line1', { length: 200 }).notNull(),
    line2: varchar('line2', { length: 200 }),
    city: varchar('city', { length: 100 }).notNull(),
    state: varchar('state', { length: 2 }).notNull(),
    zip: varchar('zip', { length: 10 }).notNull(),
    country: varchar('country', { length: 2 }).notNull().default('US'),
    phone: varchar('phone', { length: 32 }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('addresses_order_type_uq').on(table.orderId, table.type)],
);

export const payments = mysqlTable(
  'payments',
  {
    id: pk(),
    orderId: fk('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: mysqlEnum('provider', PAYMENT_PROVIDER).notNull(),
    /** Stripe PaymentIntent id or PayPal order id. */
    providerPaymentId: varchar('provider_payment_id', { length: 190 }).notNull(),
    status: mysqlEnum('status', PAYMENT_STATUS).notNull().default('requires_payment'),
    amountCents: money('amount_cents').notNull(),
    refundedCents: money('refunded_cents').notNull().default(0),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    /** Card brand and last four only. A PAN never reaches this system. */
    cardBrand: varchar('card_brand', { length: 40 }),
    cardLast4: varchar('card_last4', { length: 4 }),
    failureCode: varchar('failure_code', { length: 80 }),
    failureMessage: varchar('failure_message', { length: 400 }),
    /** The provider payload as received, for reconciliation and dispute handling. */
    rawPayload: json('raw_payload'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('payments_provider_payment_uq').on(table.provider, table.providerPaymentId),
    index('payments_order_idx').on(table.orderId),
    check('payments_refund_within_amount', sql`${table.refundedCents} <= ${table.amountCents}`),
  ],
);

/**
 * Webhook idempotency. The unique constraint on `event_id` is the whole mechanism: the row
 * is inserted before the event is processed, so a duplicate delivery hits the constraint and
 * returns 200 without touching an order twice.
 */
export const webhookEvents = mysqlTable(
  'webhook_events',
  {
    id: pk(),
    provider: mysqlEnum('provider', PAYMENT_PROVIDER).notNull(),
    eventId: varchar('event_id', { length: 190 }).notNull(),
    eventType: varchar('event_type', { length: 120 }).notNull(),
    payload: json('payload'),
    processedAt: at('processed_at'),
    error: text('error'),
    attempts: int('attempts').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('webhook_events_event_id_uq').on(table.provider, table.eventId),
    index('webhook_events_processed_idx').on(table.processedAt),
  ],
);

/**
 * One row per successful use of a promo code. `promo_codes.used_count` is the fast counter;
 * this is what makes a per-customer limit enforceable and what an audit reads.
 */
export const promoRedemptions = mysqlTable(
  'promo_redemptions',
  {
    id: pk(),
    promoCodeId: fk('promo_code_id')
      .notNull()
      .references(() => promoCodes.id, { onDelete: 'cascade' }),
    orderId: fk('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    customerId: fk('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    email: email().notNull(),
    discountCents: money('discount_cents').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('promo_redemptions_order_uq').on(table.orderId, table.promoCodeId),
    index('promo_redemptions_email_idx').on(table.promoCodeId, table.email),
  ],
);

// --------------------------------------------------------------------------------------
// Relations
// --------------------------------------------------------------------------------------

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  items: many(orderItems),
  addresses: many(addresses),
  payments: many(payments),
  redemptions: many(promoRedemptions),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  order: one(orders, { fields: [addresses.orderId], references: [orders.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));

export const promoCodesRelations = relations(promoCodes, ({ many }) => ({
  redemptions: many(promoRedemptions),
}));

export const promoRedemptionsRelations = relations(promoRedemptions, ({ one }) => ({
  promoCode: one(promoCodes, {
    fields: [promoRedemptions.promoCodeId],
    references: [promoCodes.id],
  }),
  order: one(orders, { fields: [promoRedemptions.orderId], references: [orders.id] }),
}));
