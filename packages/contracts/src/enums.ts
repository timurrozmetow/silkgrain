import { z } from 'zod';

import {
  BUSINESS_TYPE,
  CERTIFICATION,
  ORIGIN,
  PRODUCT_BADGE,
  PRODUCT_STATUS,
  VOLUME_BAND,
  WEIGHT_UNIT,
  WHOLESALE_STATUS,
} from './constants';

/**
 * Every closed value set in the platform, declared exactly once.
 *
 * Each entry is a `const` tuple plus a Zod enum built from it. The tuple is what Drizzle's
 * `mysqlEnum` takes, so the column definition and the validation schema cannot drift apart —
 * adding a value in one place is a type error until it is added in the other.
 */

// --------------------------------------------------------------------------------------
// Catalog
// --------------------------------------------------------------------------------------

/**
 * Country of origin. ISO 3166-1 alpha-2 for the five Central Asian sources we buy from,
 * plus `MIXED` for blends such as the plov spice mix, which the mockup labels
 * "Mixed Origin". The region is a free-text column next to it ("Fergana Valley").
 */
export const Origin = z.enum(ORIGIN);
export type Origin = z.infer<typeof Origin>;

/**
 * Units a variant can be sold in. `kit` is a countable unit, not a weight — the Lagman
 * Noodle Kit is sold as "1 kit" and has no meaningful gram equivalent.
 */
export const WeightUnit = z.enum(WEIGHT_UNIT);
export type WeightUnit = z.infer<typeof WeightUnit>;

export const Certification = z.enum(CERTIFICATION);
export type Certification = z.infer<typeof Certification>;

/**
 * Where a product's nutrition figures came from (decision D-20).
 *
 * `reference` is the seed's category-level average - honest about a lentil in general, silent
 * about this bag in particular. `entered` means somebody read the packaging. The storefront draws
 * the panel either way; the difference matters to whoever is answerable for the numbers.
 */
export const NUTRITION_SOURCE = ['reference', 'entered'] as const;
export const NutritionSource = z.enum(NUTRITION_SOURCE);
export type NutritionSource = z.infer<typeof NutritionSource>;

/**
 * Badges an editor sets by hand. `sale` and `organic` are deliberately absent: `sale` is
 * true exactly when a variant has a `compare_at_price_cents`, and `organic` is true exactly
 * when the product carries the organic certification. Storing either as a badge would give
 * the same fact two sources of truth that can disagree.
 */
export const ProductBadge = z.enum(PRODUCT_BADGE);
export type ProductBadge = z.infer<typeof ProductBadge>;

/** What the storefront renders: the editorial badges plus the two derived ones. */
export const BADGE = [...PRODUCT_BADGE, 'sale', 'organic'] as const;
export const Badge = z.enum(BADGE);
export type Badge = z.infer<typeof Badge>;

export const ProductStatus = z.enum(PRODUCT_STATUS);
export type ProductStatus = z.infer<typeof ProductStatus>;

/** Derived from `stock_qty` against the variant's `low_stock_threshold`, never stored. */
export const STOCK_STATE = ['in', 'low', 'out'] as const;
export const StockState = z.enum(STOCK_STATE);
export type StockState = z.infer<typeof StockState>;

export const REVIEW_STATUS = ['pending', 'published', 'rejected'] as const;
export const ReviewStatus = z.enum(REVIEW_STATUS);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

// --------------------------------------------------------------------------------------
// Orders and payments
// --------------------------------------------------------------------------------------

export const ORDER_STATUS = [
  'pending',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;
export const OrderStatus = z.enum(ORDER_STATUS);
export type OrderStatus = z.infer<typeof OrderStatus>;

/**
 * Which transitions the admin panel may perform. `pending -> paid` is absent on purpose:
 * an order becomes paid inside the payment webhook's transaction and nowhere else.
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['cancelled'],
  paid: ['processing', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

/**
 * The statuses that mean money arrived and stayed.
 *
 * One definition, because three screens claim to agree about it: the dashboard's revenue, the
 * customer's own lifetime-spend card, and the admin's customer list. Each held its own array
 * literal until this existed, and the only thing keeping them equal was that nobody had edited
 * one of them yet.
 *
 * Not to be conflated with "stock has left the shelf", which lists the same four today and is a
 * different idea: a cancelled-after-shipping order would move one and not the other.
 */
export const EARNED_ORDER_STATUS = [
  'paid',
  'processing',
  'shipped',
  'delivered',
] as const satisfies readonly OrderStatus[];

export const PAYMENT_PROVIDER = ['stripe', 'paypal'] as const;
export const PaymentProvider = z.enum(PAYMENT_PROVIDER);
export type PaymentProvider = z.infer<typeof PaymentProvider>;

export const PAYMENT_STATUS = [
  'requires_payment',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'refunded',
  'partially_refunded',
] as const;
export const PaymentStatus = z.enum(PAYMENT_STATUS);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const ADDRESS_TYPE = ['shipping', 'billing'] as const;
export const AddressType = z.enum(ADDRESS_TYPE);
export type AddressType = z.infer<typeof AddressType>;

/**
 * Shipping method codes. Rates, prices and delivery estimates live in `shipping_rates` and
 * are edited in the admin panel (decision D-2); only the set of codes is fixed here, because
 * the checkout UI and the order snapshot both key off it.
 */
export const SHIPPING_METHOD = ['standard', 'express', 'overnight'] as const;
export const ShippingMethod = z.enum(SHIPPING_METHOD);
export type ShippingMethod = z.infer<typeof ShippingMethod>;

export const PROMO_TYPE = ['percent', 'fixed', 'free_shipping'] as const;
export const PromoType = z.enum(PROMO_TYPE);
export type PromoType = z.infer<typeof PromoType>;

export const INVENTORY_REASON = [
  'order',
  'restock',
  'adjustment',
  'return',
  'cancellation',
] as const;
export const InventoryReason = z.enum(INVENTORY_REASON);
export type InventoryReason = z.infer<typeof InventoryReason>;

// --------------------------------------------------------------------------------------
// Wholesale
// --------------------------------------------------------------------------------------

// Both arrays live in `../constants`, Zod-free, because the wholesale form's selects need them
// and a value import from this file would put the whole schema layer in the browser bundle.
export const BusinessType = z.enum(BUSINESS_TYPE);
export type BusinessType = z.infer<typeof BusinessType>;

export const VolumeBand = z.enum(VOLUME_BAND);
export type VolumeBand = z.infer<typeof VolumeBand>;

export const WholesaleStatus = z.enum(WHOLESALE_STATUS);
export type WholesaleStatus = z.infer<typeof WholesaleStatus>;

// --------------------------------------------------------------------------------------
// People and access
// --------------------------------------------------------------------------------------

/**
 * `owner` sees and does everything including settings and pricing; `manager` runs the
 * catalogue and orders; `support` reads orders and answers wholesale enquiries.
 */
export const ADMIN_ROLE = ['owner', 'manager', 'support'] as const;
export const AdminRole = z.enum(ADMIN_ROLE);
export type AdminRole = z.infer<typeof AdminRole>;

/**
 * Which contour a token or session belongs to. Customer and admin credentials are separate
 * tables and separate signing audiences: a customer token must never satisfy an admin guard.
 */
export const SUBJECT_TYPE = ['customer', 'admin'] as const;
export const SubjectType = z.enum(SUBJECT_TYPE);
export type SubjectType = z.infer<typeof SubjectType>;

export const CUSTOMER_STATUS = ['active', 'blocked'] as const;
export const CustomerStatus = z.enum(CUSTOMER_STATUS);
export type CustomerStatus = z.infer<typeof CustomerStatus>;

export const CONTACT_STATUS = ['new', 'read', 'answered', 'spam'] as const;
export const ContactStatus = z.enum(CONTACT_STATUS);
export type ContactStatus = z.infer<typeof ContactStatus>;

export const NEWSLETTER_STATUS = ['subscribed', 'unsubscribed', 'bounced'] as const;
export const NewsletterStatus = z.enum(NEWSLETTER_STATUS);
export type NewsletterStatus = z.infer<typeof NewsletterStatus>;

// --------------------------------------------------------------------------------------
// Content
// --------------------------------------------------------------------------------------

export const RECIPE_DIFFICULTY = ['easy', 'medium', 'hard'] as const;
export const RecipeDifficulty = z.enum(RECIPE_DIFFICULTY);
export type RecipeDifficulty = z.infer<typeof RecipeDifficulty>;

export const FAQ_CATEGORY = ['ordering', 'shipping', 'products', 'wholesale', 'returns'] as const;
export const FaqCategory = z.enum(FAQ_CATEGORY);
export type FaqCategory = z.infer<typeof FaqCategory>;

// --------------------------------------------------------------------------------------
// The audit log
// --------------------------------------------------------------------------------------

/** What an entry points at. `price_batch` is not a table - it is one bulk operation. */
export const AUDIT_ENTITY_TYPE = [
  'product',
  'category',
  'order',
  'customer',
  'promo_code',
  'setting',
  'shipping_rate',
  'wholesale_request',
  'price_batch',
  'admin_user',
] as const;
export const AuditEntityType = z.enum(AUDIT_ENTITY_TYPE);
export type AuditEntityType = z.infer<typeof AuditEntityType>;

/**
 * One action string per audited write route.
 *
 * One-to-one on purpose: it makes the vocabulary complete and testable, and a test asserts that
 * the set of actions the routes actually produce is exactly this list. A route that grows without
 * an action fails that test rather than quietly going unlogged.
 *
 * `POST /api/admin/wholesale/requests/:id/notes` is the deliberate omission. A wholesale note is
 * already an append-only row carrying its author and the time - it *is* the audit record, and
 * logging it would copy the thread into a second place that can disagree with it.
 */
export const AUDIT_ACTION = [
  'product.created',
  'product.updated',
  'product.image_added',
  'product.image_updated',
  'product.images_arranged',
  'product.image_removed',
  'category.created',
  'category.updated',
  'category.active_changed',
  'category.image_updated',
  'category.image_removed',
  'order.status_changed',
  'order.tracking_updated',
  'order.note_updated',
  'customer.status_changed',
  'promo.created',
  'promo.updated',
  'promo.active_changed',
  'pricing.applied',
  'settings.updated',
  'shipping_rate.updated',
  'wholesale.triaged',
  'admin_user.created',
  'admin_user.updated',
  'admin_user.password_reset',
] as const;
export const AuditAction = z.enum(AUDIT_ACTION);
export type AuditAction = z.infer<typeof AuditAction>;

/** Which entity each action is about, so the writer never has to be told twice. */
export const AUDIT_ACTION_ENTITY: Readonly<Record<AuditAction, AuditEntityType>> = {
  'product.created': 'product',
  'product.updated': 'product',
  'product.image_added': 'product',
  'product.image_updated': 'product',
  'product.images_arranged': 'product',
  'product.image_removed': 'product',
  'category.created': 'category',
  'category.updated': 'category',
  'category.active_changed': 'category',
  'category.image_updated': 'category',
  'category.image_removed': 'category',
  'order.status_changed': 'order',
  'order.tracking_updated': 'order',
  'order.note_updated': 'order',
  'customer.status_changed': 'customer',
  'promo.created': 'promo_code',
  'promo.updated': 'promo_code',
  'promo.active_changed': 'promo_code',
  'pricing.applied': 'price_batch',
  'settings.updated': 'setting',
  'shipping_rate.updated': 'shipping_rate',
  'wholesale.triaged': 'wholesale_request',
  'admin_user.created': 'admin_user',
  'admin_user.updated': 'admin_user',
  'admin_user.password_reset': 'admin_user',
};
