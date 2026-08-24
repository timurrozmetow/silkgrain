import {
  CART_LINE_MAX_QTY,
  type CartAdjustment,
  type CartQuote,
  type CartQuoteInput,
  type CartQuoteLine,
  Money,
  type StockState,
} from '@silkgrain/contracts';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { categories, productImages, productVariants, products } from '../../db/schema';
import { DEFAULT_TAX_BASIS_POINTS, TAX_RATE_SETTING, readIntegerSetting } from '../../lib/settings';

import { evaluatePromo, type PromoIdentity } from './promo.service';
import { quoteShipping } from './shipping.service';

/**
 * Pricing a cart the client cannot lie about.
 *
 * The request carries variant ids and quantities and nothing else. Every price, every discount
 * and every total below is read from `product_variants`, `promo_codes` and `shipping_rates` in
 * this function. There is no branch that trusts an amount from the request, because the schema
 * gives the request nowhere to put one - `CartLineInput` is `.strict()` and has two fields.
 *
 * The arithmetic deliberately matches the seeded orders line for line:
 * `taxable = subtotal - discount + shipping`, tax on the taxable base, total on top. Texas
 * taxes shipping, and a quote that disagreed with what Phase 4 writes into `orders` would be a
 * customer charged something other than what the cart showed.
 */

export interface CartQuoteOptions {
  /** True for the Apply button, which owes the customer an error; false for a page load. */
  strictPromo: boolean;
  identity: PromoIdentity;
}

interface VariantRow {
  variantId: number;
  productId: number;
  productSlug: string;
  name: string;
  categoryName: string;
  sku: string;
  weightLabel: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  stockQty: number;
  lowStockThreshold: number;
}

export async function quoteCart(
  db: Database,
  input: CartQuoteInput,
  options: CartQuoteOptions,
): Promise<CartQuote> {
  const requested = mergeLines(input.lines);
  const available = await loadVariants(db, [...requested.keys()]);
  const images = await loadPrimaryImages(db, [
    ...new Set([...available.values()].map((row) => row.productId)),
  ]);

  const lines: CartQuoteLine[] = [];
  const adjustments: CartAdjustment[] = [];

  for (const [variantId, requestedQty] of requested) {
    const variant = available.get(variantId);

    // Retired, archived, or belonging to a product that was unpublished. The cart was written
    // to `localStorage` at some point in the past; this is that past catching up with it.
    if (!variant) {
      adjustments.push({
        variantId,
        reason: 'removed_unavailable',
        name: 'This item',
        weightLabel: '',
        requestedQty,
        acceptedQty: 0,
        message: 'This item is no longer available and was removed from your cart',
      });
      continue;
    }

    if (variant.stockQty <= 0) {
      adjustments.push({
        variantId,
        reason: 'removed_out_of_stock',
        name: variant.name,
        weightLabel: variant.weightLabel,
        requestedQty,
        acceptedQty: 0,
        message: `${variant.name} (${variant.weightLabel}) is out of stock and was removed`,
      });
      continue;
    }

    const acceptedQty = Math.min(requestedQty, Math.min(variant.stockQty, CART_LINE_MAX_QTY));
    if (acceptedQty < requestedQty) {
      adjustments.push({
        variantId,
        reason: 'qty_reduced',
        name: variant.name,
        weightLabel: variant.weightLabel,
        requestedQty,
        acceptedQty,
        message: `Only ${String(acceptedQty)} of ${variant.name} (${variant.weightLabel}) could be reserved`,
      });
    }

    const unitPrice = Money.fromCents(variant.priceCents);
    lines.push({
      variantId: variant.variantId,
      productId: variant.productId,
      productSlug: variant.productSlug,
      name: variant.name,
      categoryName: variant.categoryName,
      weightLabel: variant.weightLabel,
      sku: variant.sku,
      image: images.get(variant.productId) ?? null,
      qty: acceptedQty,
      unitPriceCents: unitPrice.cents,
      compareAtPriceCents: variant.compareAtPriceCents,
      lineTotalCents: unitPrice.multiply(acceptedQty).cents,
      stockState: stockStateOf(variant),
      availableQty: Math.min(variant.stockQty, CART_LINE_MAX_QTY),
    });
  }

  const subtotal = Money.sum(lines.map((line) => Money.fromCents(line.lineTotalCents)));

  const promo =
    input.promoCode === undefined
      ? { applied: null, rejected: null }
      : await evaluatePromo(db, input.promoCode, subtotal, options.identity, options.strictPromo);

  const discount = Money.fromCents(promo.applied?.discountCents ?? 0);
  const afterDiscount = subtotal.subtract(discount);

  const shipping = await quoteShipping(
    db,
    input.shippingMethod,
    afterDiscount,
    promo.applied?.coversShipping ?? false,
  );

  // An empty cart ships nothing. Every line can disappear between the request and the
  // recalculation - a sold-out variant, a retired product - and quoting postage on nothing
  // would put a total on a page that has no items to justify it.
  const shippingCost =
    lines.length === 0 ? Money.zero() : Money.fromCents(shipping.selected.priceCents);
  const taxRate = await readIntegerSetting(db, TAX_RATE_SETTING, DEFAULT_TAX_BASIS_POINTS);
  const taxable = afterDiscount.add(shippingCost);
  const tax = taxable.basisPoints(taxRate);

  return {
    lines,
    itemCount: lines.reduce((total, line) => total + line.qty, 0),
    subtotalCents: subtotal.cents,
    discountCents: discount.cents,
    shippingCents: shippingCost.cents,
    taxCents: tax.cents,
    taxIsEstimated: true,
    totalCents: taxable.add(tax).cents,
    currency: 'USD',
    promo: promo.applied,
    promoRejected: promo.rejected,
    shippingMethod: shipping.selected.code,
    shippingOptions: shipping.options,
    freeShipping: shipping.progress,
    adjustments,
  };
}

/**
 * The same variant can arrive twice - two tabs, or a "buy again" that appended rather than
 * incremented. Summing is what the customer meant; rejecting the request would lose a cart.
 * Insertion order is preserved, so the cart renders in the order the customer built it.
 */
function mergeLines(lines: readonly { variantId: number; qty: number }[]): Map<number, number> {
  const merged = new Map<number, number>();
  for (const line of lines) {
    merged.set(line.variantId, (merged.get(line.variantId) ?? 0) + line.qty);
  }
  return merged;
}

async function loadVariants(db: Database, ids: number[]): Promise<Map<number, VariantRow>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productSlug: products.slug,
      name: products.name,
      categoryName: categories.name,
      sku: productVariants.sku,
      weightLabel: productVariants.weightLabel,
      priceCents: productVariants.priceCents,
      compareAtPriceCents: productVariants.compareAtPriceCents,
      stockQty: productVariants.stockQty,
      lowStockThreshold: productVariants.lowStockThreshold,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        inArray(productVariants.id, ids),
        eq(productVariants.isActive, true),
        eq(products.status, 'active'),
      ),
    );

  return new Map(rows.map((row) => [row.variantId, row]));
}

async function loadPrimaryImages(
  db: Database,
  productIds: number[],
): Promise<Map<number, { url: string; alt: string }>> {
  if (productIds.length === 0) return new Map();

  const rows = await db
    .select({ productId: productImages.productId, url: productImages.url, alt: productImages.alt })
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(desc(productImages.isPrimary), asc(productImages.position), asc(productImages.id));

  const byProduct = new Map<number, { url: string; alt: string }>();
  for (const row of rows) {
    if (!byProduct.has(row.productId)) byProduct.set(row.productId, { url: row.url, alt: row.alt });
  }
  return byProduct;
}

function stockStateOf(variant: Pick<VariantRow, 'stockQty' | 'lowStockThreshold'>): StockState {
  if (variant.stockQty <= 0) return 'out';
  return variant.stockQty <= variant.lowStockThreshold ? 'low' : 'in';
}
