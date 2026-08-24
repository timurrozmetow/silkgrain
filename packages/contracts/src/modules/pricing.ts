import { z } from 'zod';

import {
  PRICE_ADJUST_MAX_BASIS_POINTS,
  PRICE_ADJUST_MIN_BASIS_POINTS,
  PRICE_BATCH_MAX,
  SALE_DISCOUNT_MAX_BASIS_POINTS,
  SALE_DISCOUNT_MIN_BASIS_POINTS,
} from '../constants';
import { ProductStatus } from '../enums';
import { Cents, Currency, Id, Slug } from '../primitives';

/**
 * Bulk price operations.
 *
 * The screen is a two-step machine: a preview that computes every affected row and writes nothing,
 * then an apply that re-derives the same figures from locked rows and refuses if anything moved
 * underneath. The client echoes back what it saw (`seen*`) as a precondition, never as an
 * instruction - the server writes only figures it recomputes from its own rows, which is the
 * admin-side reading of "a stale total is a 409, never a silent charge".
 */

/**
 * The four operations.
 *
 * `adjust_cents` exists precisely because it has no rounding decision to get wrong - a flat 50c
 * surcharge lands on 50c on every SKU, where a percentage would land somewhere different on each.
 * `end_sale` carries no figure because it has one meaning: restore the list price the compare-at
 * remembers. `start_sale` refuses a variant that already has a compare-at, because overwriting a
 * true list price with an already-discounted one is the one irreversible mistake here.
 */
export const AdminPriceOperation = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('adjust_percent'),
      deltaBasisPoints: z
        .number()
        .int()
        .min(PRICE_ADJUST_MIN_BASIS_POINTS)
        .max(PRICE_ADJUST_MAX_BASIS_POINTS)
        .refine((value) => value !== 0, 'A change of nothing is not a change'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('adjust_cents'),
      deltaCents: z
        .number()
        .int()
        .min(-100_000)
        .max(100_000)
        .refine((value) => value !== 0, 'A change of nothing is not a change'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('start_sale'),
      discountBasisPoints: z
        .number()
        .int()
        .min(SALE_DISCOUNT_MIN_BASIS_POINTS)
        .max(SALE_DISCOUNT_MAX_BASIS_POINTS),
    })
    .strict(),
  z.object({ kind: z.literal('end_sale') }).strict(),
]);
export type AdminPriceOperation = z.infer<typeof AdminPriceOperation>;

/**
 * Which variants an operation reaches.
 *
 * Defaults to active products and active variants, because a bulk raise across drafts and retired
 * SKUs is almost never what an operator means; both are opt-in.
 */
export const AdminPriceScope = z
  .object({
    q: z.string().trim().max(120).optional(),
    category: Slug.optional(),
    status: z.union([ProductStatus, z.literal('all')]).default('active'),
    includeInactiveVariants: z.boolean().default(false),
  })
  .strict();
export type AdminPriceScope = z.infer<typeof AdminPriceScope>;

export const AdminPricePreviewInput = z
  .object({ scope: AdminPriceScope, operation: AdminPriceOperation })
  .strict();
export type AdminPricePreviewInput = z.infer<typeof AdminPricePreviewInput>;

export const AdminPriceVerdict = z.enum(['change', 'unchanged', 'blocked']);
export type AdminPriceVerdict = z.infer<typeof AdminPriceVerdict>;

/**
 * Why a row cannot take the operation.
 *
 * `price_not_positive` is a raise or a cut landing at or below zero; the cart prices from
 * `price_cents`, so a zero-priced variant is an order for nothing anybody can check out.
 * `compare_at_not_above` is the `product_variants_compare_at_higher` CHECK, caught here so it is a
 * deselectable row rather than a 500 mid-batch. `already_on_sale` is `start_sale` on a variant that
 * already carries a compare-at - the one irreversible mistake, so it is refused rather than run.
 */
export const AdminPriceBlocker = z.enum([
  'price_not_positive',
  'compare_at_not_above',
  'already_on_sale',
]);
export type AdminPriceBlocker = z.infer<typeof AdminPriceBlocker>;

export const AdminPricePreviewRow = z.object({
  variantId: Id,
  productId: Id,
  productName: z.string(),
  productStatus: ProductStatus,
  sku: z.string(),
  weightLabel: z.string(),
  isActive: z.boolean(),
  priceCents: Cents,
  newPriceCents: Cents,
  compareAtPriceCents: Cents.nullable(),
  newCompareAtPriceCents: Cents.nullable(),
  costCents: Cents.nullable(),
  /** Margin on the new price, in basis points. Null when cost is unknown or the price is zero. */
  newMarginBasisPoints: z.number().int().nullable(),
  belowCost: z.boolean(),
  verdict: AdminPriceVerdict,
  blockedBy: AdminPriceBlocker.nullable(),
});
export type AdminPricePreviewRow = z.infer<typeof AdminPricePreviewRow>;

export const AdminPricePreview = z.object({
  operation: AdminPriceOperation,
  currency: Currency,
  counts: z.object({
    change: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    belowCost: z.number().int().nonnegative(),
  }),
  /** Sum of unit list prices over the rows that would change - a sanity check, not revenue. */
  currentPriceTotalCents: Cents,
  newPriceTotalCents: Cents,
  rows: z.array(AdminPricePreviewRow),
});
export type AdminPricePreview = z.infer<typeof AdminPricePreview>;

/**
 * One row an apply commits to, carrying what the preview showed.
 *
 * `seen*` is a precondition, never a source: the server recomputes the new figure from its own
 * locked row, and refuses the whole batch if any row's stored price no longer equals what the
 * operator saw. Given the precondition holds, the recomputed value is necessarily the previewed one.
 */
export const AdminPriceApplyRow = z
  .object({
    variantId: Id,
    seenPriceCents: Cents,
    seenCompareAtPriceCents: Cents.nullable(),
  })
  .strict();
export type AdminPriceApplyRow = z.infer<typeof AdminPriceApplyRow>;

export const AdminPriceApplyInput = z
  .object({
    operation: AdminPriceOperation,
    rows: z.array(AdminPriceApplyRow).min(1).max(PRICE_BATCH_MAX),
    /** Selling under landed cost is a real decision; it just cannot happen silently. */
    allowBelowCost: z.boolean().default(false),
  })
  .strict();
export type AdminPriceApplyInput = z.infer<typeof AdminPriceApplyInput>;

export const AdminPriceAppliedRow = AdminPricePreviewRow.pick({
  variantId: true,
  sku: true,
  productName: true,
  weightLabel: true,
  priceCents: true,
  newPriceCents: true,
  compareAtPriceCents: true,
  newCompareAtPriceCents: true,
});
export type AdminPriceAppliedRow = z.infer<typeof AdminPriceAppliedRow>;

export const AdminPriceApplyResult = z
  .object({
    changed: z.number().int().nonnegative(),
    currency: Currency,
    rows: z.array(AdminPriceAppliedRow),
  })
  .strict();
export type AdminPriceApplyResult = z.infer<typeof AdminPriceApplyResult>;
