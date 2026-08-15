import {
  type AdminPriceApplyInput,
  type AdminPriceApplyResult,
  type AdminPriceBlocker,
  type AdminPriceOperation,
  type AdminPricePreview,
  type AdminPricePreviewInput,
  type AdminPricePreviewRow,
  type AdminPriceVerdict,
  Money,
  PRICE_BATCH_MAX,
} from '@silkgrain/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { productVariants, products } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { likePattern } from '../catalog/catalog.query';
import { resolveCategoryIds } from '../catalog/catalog.service';

/**
 * Bulk price operations, as a two-step machine.
 *
 * `computeChange` is the whole of the arithmetic and is pure: preview calls it to show what would
 * happen, apply calls it again on the locked row and writes the result. The apply never reads a
 * figure out of the request - the client's `seen*` values are a precondition it checks, not a
 * source it trusts. Given the precondition holds, the recomputed price is necessarily the one the
 * preview displayed, which is what makes `seenPriceCents` a precondition rather than a price the
 * client set.
 */

/** A variant as both steps read it: the price columns, the cost, and enough to name it. */
export interface PriceVariantRow {
  variantId: number;
  productId: number;
  productName: string;
  productStatus: 'draft' | 'active' | 'archived';
  sku: string;
  weightLabel: string;
  isActive: boolean;
  priceCents: number;
  compareAtPriceCents: number | null;
  costCents: number | null;
}

interface Change {
  newPriceCents: number;
  newCompareAtPriceCents: number | null;
  verdict: AdminPriceVerdict;
  blockedBy: AdminPriceBlocker | null;
}

/**
 * The one rounding step, half to even, through `Money.basisPoints(10_000 + delta)`.
 *
 * Not `price.add(price.basisPoints(delta))`: rounding an intermediate the operator never sees can
 * flip the parity half-even tests. At 1005 cents +10 % the two-step gives 1105 and the one-step
 * 1106. `Money.basisPoints` is already the codebase's only percentage rounding - a second rule
 * would be a second answer to the same question.
 */
function raisePrice(cents: number, deltaBasisPoints: number): number {
  return Money.fromCents(cents).basisPoints(10_000 + deltaBasisPoints).cents;
}

/**
 * What one operation does to one variant. Pure, total, and shared by preview and apply.
 *
 * `compare_at` moves under the same operation whenever it is set, or a raise silently shrinks every
 * advertised discount until the Sale badge (which by D-12 *is* the compare-at) quietly stops being
 * true. A result that breaks a rule the database enforces - a non-positive price, a compare-at no
 * longer strictly above the price - is `blocked` rather than clamped, so it becomes a row an
 * operator can deselect rather than a 500 mid-transaction.
 */
export function computeChange(operation: AdminPriceOperation, row: PriceVariantRow): Change {
  const unchanged: Change = {
    newPriceCents: row.priceCents,
    newCompareAtPriceCents: row.compareAtPriceCents,
    verdict: 'unchanged',
    blockedBy: null,
  };
  const blocked = (blockedBy: AdminPriceBlocker): Change => ({
    ...unchanged,
    blockedBy,
    verdict: 'blocked',
  });

  if (operation.kind === 'end_sale') {
    // No compare-at is nothing to end.
    if (row.compareAtPriceCents === null) return unchanged;
    return {
      newPriceCents: row.compareAtPriceCents,
      newCompareAtPriceCents: null,
      verdict: 'change',
      blockedBy: null,
    };
  }

  if (operation.kind === 'start_sale') {
    // A markdown on a markdown would overwrite the true list price, which nothing could recover.
    if (row.compareAtPriceCents !== null) return blocked('already_on_sale');
    const newPrice = raisePrice(row.priceCents, -operation.discountBasisPoints);
    if (newPrice < 1) return blocked('price_not_positive');
    if (newPrice >= row.priceCents) return blocked('compare_at_not_above');
    return {
      newPriceCents: newPrice,
      newCompareAtPriceCents: row.priceCents,
      verdict: 'change',
      blockedBy: null,
    };
  }

  const newPrice =
    operation.kind === 'adjust_percent'
      ? raisePrice(row.priceCents, operation.deltaBasisPoints)
      : row.priceCents + operation.deltaCents;

  if (newPrice < 1) return blocked('price_not_positive');
  if (newPrice === row.priceCents) return unchanged;
  // A compare-at that is set moves with the price, or the advertised discount drifts and the
  // CHECK aborts the batch. If the moved compare-at is no longer above the new price, block.
  if (row.compareAtPriceCents !== null && row.compareAtPriceCents <= newPrice) {
    return blocked('compare_at_not_above');
  }
  return {
    newPriceCents: newPrice,
    newCompareAtPriceCents: row.compareAtPriceCents,
    verdict: 'change',
    blockedBy: null,
  };
}

function marginBasisPoints(priceCents: number, costCents: number | null): number | null {
  if (costCents === null || priceCents <= 0) return null;
  return Math.round(((priceCents - costCents) / priceCents) * 10_000);
}

function toPreviewRow(row: PriceVariantRow, change: Change): AdminPricePreviewRow {
  const belowCost =
    change.verdict === 'change' && row.costCents !== null && change.newPriceCents < row.costCents;
  return {
    variantId: row.variantId,
    productId: row.productId,
    productName: row.productName,
    productStatus: row.productStatus,
    sku: row.sku,
    weightLabel: row.weightLabel,
    isActive: row.isActive,
    priceCents: row.priceCents,
    newPriceCents: change.newPriceCents,
    compareAtPriceCents: row.compareAtPriceCents,
    newCompareAtPriceCents: change.newCompareAtPriceCents,
    costCents: row.costCents,
    newMarginBasisPoints: marginBasisPoints(change.newPriceCents, row.costCents),
    belowCost,
    verdict: change.verdict,
    blockedBy: change.blockedBy,
  };
}

/**
 * The variants a scope selects.
 *
 * Joined to products for the name and status, and to categories only when a category slug narrows
 * it. Ordered by id so the row list is stable between a preview and the apply that follows it.
 */
async function selectScope(
  db: Database,
  scope: AdminPricePreviewInput['scope'],
): Promise<PriceVariantRow[]> {
  const filters = [];
  if (scope.status !== 'all') filters.push(eq(products.status, scope.status));
  if (!scope.includeInactiveVariants) filters.push(eq(productVariants.isActive, true));
  if (scope.q !== undefined && scope.q !== '') {
    const pattern = likePattern(scope.q);
    filters.push(sql`(${products.name} LIKE ${pattern} OR ${productVariants.sku} LIKE ${pattern})`);
  }
  if (scope.category !== undefined) {
    // Children folded in, as the storefront's facet does (D-21): scoping to "Rice & Grains"
    // reaches the long-grain-rice products under it, which is what an operator means.
    const ids = await resolveCategoryIds(db, [scope.category]);
    // An empty resolution matches nothing, rather than silently dropping the filter and pricing
    // the whole catalogue.
    filters.push(ids.length === 0 ? sql`1 = 0` : inArray(products.categoryId, ids));
  }

  const base = db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productName: products.name,
      productStatus: products.status,
      sku: productVariants.sku,
      weightLabel: productVariants.weightLabel,
      isActive: productVariants.isActive,
      priceCents: productVariants.priceCents,
      compareAtPriceCents: productVariants.compareAtPriceCents,
      costCents: productVariants.costCents,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(filters.length === 0 ? undefined : and(...filters))
    .orderBy(asc(productVariants.id));

  // The preview reads without a lock; the apply locks by explicit id inside its transaction.
  return base;
}

export async function previewPricing(
  db: Database,
  input: AdminPricePreviewInput,
): Promise<AdminPricePreview> {
  const variants = await selectScope(db, input.scope);
  if (variants.length > PRICE_BATCH_MAX) {
    throw new AppError(
      'PRICE_BATCH_TOO_LARGE',
      `That scope matches ${String(variants.length)} variants; narrow it to ${String(PRICE_BATCH_MAX)} or fewer`,
    );
  }

  const rows = variants.map((variant) =>
    toPreviewRow(variant, computeChange(input.operation, variant)),
  );

  const counts = { change: 0, unchanged: 0, blocked: 0, belowCost: 0 };
  let currentPriceTotalCents = 0;
  let newPriceTotalCents = 0;
  for (const row of rows) {
    counts[row.verdict] += 1;
    if (row.belowCost) counts.belowCost += 1;
    if (row.verdict === 'change') {
      currentPriceTotalCents += row.priceCents;
      newPriceTotalCents += row.newPriceCents;
    }
  }

  return {
    operation: input.operation,
    currency: 'USD',
    counts,
    currentPriceTotalCents,
    newPriceTotalCents,
    rows,
  };
}

/**
 * Applies an operation to the rows the operator confirmed, all of them or none.
 *
 * Everything is one transaction, and the affected rows are locked in ascending id order before
 * anything is computed - the product form writes the same columns, so without the lock an editor
 * saving a variant between the precondition check and the UPDATE would have their change overwritten
 * by arithmetic based on the price they replaced. A row whose stored price no longer equals what the
 * operator saw, a row that recomputes to `blocked`, or a below-cost row without `allowBelowCost`,
 * refuses the whole batch: there is no audit log yet, so a partial apply would be unrecoverable.
 */
export async function applyPricing(
  db: Database,
  input: AdminPriceApplyInput,
): Promise<AdminPriceApplyResult> {
  return db.transaction(async (tx) => {
    const ids = input.rows.map((row) => row.variantId);
    const locked = await tx
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        productStatus: products.status,
        sku: productVariants.sku,
        weightLabel: productVariants.weightLabel,
        isActive: productVariants.isActive,
        priceCents: productVariants.priceCents,
        compareAtPriceCents: productVariants.compareAtPriceCents,
        costCents: productVariants.costCents,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, ids))
      .orderBy(asc(productVariants.id))
      .for('update');

    const byId = new Map(locked.map((row) => [row.variantId, row]));
    const seenById = new Map(input.rows.map((row) => [row.variantId, row]));

    const applied: AdminPriceApplyResult['rows'] = [];

    for (const id of ids) {
      const row = byId.get(id);
      const seen = seenById.get(id);
      if (!row || !seen) {
        throw new AppError(
          'PRICE_ROW_BLOCKED',
          `Variant ${String(id)} is no longer in the catalogue`,
        );
      }

      // The precondition: the stored figures must equal what the operator saw. A drift is a 409,
      // never a silent write over a price somebody changed in the meantime.
      if (
        row.priceCents !== seen.seenPriceCents ||
        row.compareAtPriceCents !== seen.seenCompareAtPriceCents
      ) {
        throw new AppError(
          'PRICE_ROW_BLOCKED',
          `${row.sku} changed since the preview; run it again`,
        );
      }

      const change = computeChange(input.operation, row);
      if (change.verdict === 'blocked') {
        throw new AppError(
          'PRICE_ROW_BLOCKED',
          `${row.sku} cannot take this change (${String(change.blockedBy)})`,
        );
      }
      if (change.verdict === 'unchanged') continue;

      if (row.costCents !== null && change.newPriceCents < row.costCents && !input.allowBelowCost) {
        throw new AppError(
          'PRICE_BELOW_COST',
          `${row.sku} would sell under cost; confirm to proceed`,
        );
      }

      await tx
        .update(productVariants)
        .set({
          priceCents: change.newPriceCents,
          compareAtPriceCents: change.newCompareAtPriceCents,
        })
        .where(eq(productVariants.id, id));

      applied.push({
        variantId: id,
        sku: row.sku,
        productName: row.productName,
        weightLabel: row.weightLabel,
        priceCents: row.priceCents,
        newPriceCents: change.newPriceCents,
        compareAtPriceCents: row.compareAtPriceCents,
        newCompareAtPriceCents: change.newCompareAtPriceCents,
      });
    }

    return { changed: applied.length, currency: 'USD', rows: applied };
  });
}
