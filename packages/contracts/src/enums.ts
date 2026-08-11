import { z } from 'zod';

import { BUSINESS_TYPE, VOLUME_BAND } from './constants';

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
export const ORIGIN = ['UZ', 'KZ', 'TM', 'KG', 'TJ', 'MIXED'] as const;
export const Origin = z.enum(ORIGIN);
export type Origin = z.infer<typeof Origin>;

/**
 * Units a variant can be sold in. `kit` is a countable unit, not a weight — the Lagman
 * Noodle Kit is sold as "1 kit" and has no meaningful gram equivalent.
 */
export const WEIGHT_UNIT = ['lb', 'oz', 'g', 'kit'] as const;
export const WeightUnit = z.enum(WEIGHT_UNIT);
export type WeightUnit = z.infer<typeof WeightUnit>;

export const CERTIFICATION = ['organic', 'non_gmo', 'halal', 'kosher', 'gluten_free'] as const;
export const Certification = z.enum(CERTIFICATION);
export type Certification = z.infer<typeof Certification>;

/**
 * Badges an editor sets by hand. `sale` and `organic` are deliberately absent: `sale` is
 * true exactly when a variant has a `compare_at_price_cents`, and `organic` is true exactly
 * when the product carries the organic certification. Storing either as a badge would give
 * the same fact two sources of truth that can disagree.
 */
export const PRODUCT_BADGE = ['bestseller', 'new', 'premium'] as const;
export const ProductBadge = z.enum(PRODUCT_BADGE);
export type ProductBadge = z.infer<typeof ProductBadge>;

/** What the storefront renders: the editorial badges plus the two derived ones. */
export const BADGE = [...PRODUCT_BADGE, 'sale', 'organic'] as const;
export const Badge = z.enum(BADGE);
export type Badge = z.infer<typeof Badge>;

export const PRODUCT_STATUS = ['draft', 'active', 'archived'] as const;
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

export const WHOLESALE_STATUS = ['new', 'contacted', 'quoted', 'converted', 'declined'] as const;
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
