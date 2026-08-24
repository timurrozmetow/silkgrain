import type {
  AdminNutritionInput,
  AdminProductDetail,
  AdminProductInput,
} from '@silkgrain/contracts';
import { and, eq, inArray, notInArray } from 'drizzle-orm';

import type { Database, DbExecutor } from '../../db/client';
import {
  categories,
  productBadges,
  productCertifications,
  productNutrition,
  productVariants,
  products,
} from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';

import type { AdminActor } from './actor';
import { diffChildren, diffSnapshots, mergeDiff } from './audit.diff';
import { productSnapshot, variantSnapshot } from './audit.projectors';
import { type AuditContext, recordAudit } from './audit.service';
import { listImages } from './images.service';

/**
 * Reading and writing one product from the admin form.
 *
 * Everything a save touches happens in one transaction: the product row, its variants, its
 * certifications, its badges and its nutrition panel. Half a save is worse than a failed one - a
 * product with new variants and old certifications is a state nobody designed and nobody would
 * think to look for.
 *
 * Stock is written here because this is the form where an editor corrects it. That is not the same
 * as the webhook's decrement, which is a movement with a reason; a correction is an editor saying
 * "there are forty of these on the shelf", and the audit log (task 7.8) is where that gets its
 * paper trail.
 */

export async function getAdminProduct(db: Database, id: number): Promise<AdminProductDetail> {
  const [row] = await db.select().from(products).where(eq(products.id, id));
  if (!row) throw notFound('Product');

  const [variants, certifications, badges, nutrition, images] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))
      .orderBy(productVariants.position, productVariants.id),
    db
      .select({ certification: productCertifications.certification })
      .from(productCertifications)
      .where(eq(productCertifications.productId, id)),
    db
      .select({ badge: productBadges.badge })
      .from(productBadges)
      .where(eq(productBadges.productId, id)),
    db.select().from(productNutrition).where(eq(productNutrition.productId, id)),
    listImages(db, id),
  ]);

  const panel = nutrition[0];

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    subtitle: row.subtitle,
    blurb: row.blurb,
    description: row.description,
    story: row.story,
    categoryId: row.categoryId,
    origin: row.origin,
    originRegion: row.originRegion,
    status: row.status,
    isFeatured: row.isFeatured,
    tone: row.tone,
    icon: row.icon,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      weightValueMilli: variant.weightValueMilli,
      weightUnit: variant.weightUnit,
      weightLabel: variant.weightLabel,
      weightGrams: variant.weightGrams,
      priceCents: variant.priceCents,
      compareAtPriceCents: variant.compareAtPriceCents,
      costCents: variant.costCents,
      stockQty: variant.stockQty,
      lowStockThreshold: variant.lowStockThreshold,
      position: variant.position,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
    })),
    certifications: certifications.map((entry) => entry.certification),
    badges: badges.map((entry) => entry.badge),
    images,
    nutrition:
      panel === undefined
        ? null
        : {
            servingSize: panel.servingSize,
            servingsPerContainer: panel.servingsPerContainer,
            calories: panel.calories,
            fatMg: panel.fatMg,
            satFatMg: panel.satFatMg,
            carbsMg: panel.carbsMg,
            sugarsMg: panel.sugarsMg,
            fiberMg: panel.fiberMg,
            proteinMg: panel.proteinMg,
            sodiumMg: panel.sodiumMg,
            ingredientsText: panel.ingredientsText,
            allergensText: panel.allergensText,
          },
    nutritionSource: panel?.source ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createProduct(
  db: Database,
  input: AdminProductInput,
  actor: AdminActor,
  context: AuditContext,
): Promise<{ id: number }> {
  return db.transaction(async (tx) => {
    await assertCategoryExists(tx, input.categoryId);
    await assertSlugFree(tx, input.slug, null);

    const [row] = await tx
      .insert(products)
      .values({
        ...productColumns(input),
        // A product becomes visible the moment it goes active, and `published_at` is what "newest"
        // sorts on. Setting it on creation regardless would date a draft from before it existed.
        publishedAt: input.status === 'active' ? new Date() : null,
      })
      .$returningId();
    if (!row) throw new AppError('INTERNAL', 'The product row was not inserted');

    await writeChildren(tx, row.id, input);

    const [created] = await tx.select().from(products).where(eq(products.id, row.id));
    await recordAudit(tx, actor, context, {
      action: 'product.created',
      entityId: row.id,
      entityLabel: input.name,
      before: null,
      after: created ? productSnapshot(created) : null,
    });

    return { id: row.id };
  });
}

export async function updateProduct(
  db: Database,
  id: number,
  input: AdminProductInput,
  actor: AdminActor,
  context: AuditContext,
): Promise<{ id: number }> {
  return db.transaction(async (tx) => {
    // The whole row, not three columns: the audit entry needs the before-image, and reading it
    // twice would be two reads that can disagree.
    const [existing] = await tx.select().from(products).where(eq(products.id, id));
    if (!existing) throw notFound('Product');

    const variantsBefore = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id));

    await assertCategoryExists(tx, input.categoryId);
    await assertSlugFree(tx, input.slug, id);

    await tx
      .update(products)
      .set({
        ...productColumns(input),
        // First activation stamps the date; later edits leave it alone. Re-stamping would move a
        // product back to the top of "newest" every time somebody fixed a typo.
        publishedAt: existing.publishedAt ?? (input.status === 'active' ? new Date() : null),
      })
      .where(eq(products.id, id));

    await writeChildren(tx, id, input);

    const [after] = await tx.select().from(products).where(eq(products.id, id));
    const variantsAfter = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id));

    // The parent's own fields and its variants, in one entry. A variant added or removed reads as
    // a key with null on the other side, which is how the screen renders it.
    const delta = mergeDiff(
      after ? diffSnapshots(productSnapshot(existing), productSnapshot(after)) : null,
      (() => {
        const children = diffChildren(
          variantsBefore,
          variantsAfter,
          (variant) => variant.sku,
          variantSnapshot,
          'variants',
        );
        return Object.keys(children.after).length === 0 ? null : children;
      })(),
    );

    if (delta) {
      await recordAudit(tx, actor, context, {
        action: 'product.updated',
        entityId: id,
        entityLabel: after?.name ?? existing.name,
        before: delta.before,
        after: delta.after,
      });
    }

    return { id };
  });
}

function productColumns(input: AdminProductInput) {
  return {
    name: input.name,
    slug: input.slug,
    subtitle: input.subtitle ?? null,
    blurb: input.blurb,
    description: input.description,
    story: input.story ?? null,
    categoryId: input.categoryId,
    origin: input.origin,
    originRegion: input.originRegion ?? null,
    status: input.status,
    isFeatured: input.isFeatured,
    tone: input.tone ?? null,
    icon: input.icon ?? null,
    metaTitle: input.metaTitle ?? null,
    metaDescription: input.metaDescription ?? null,
  };
}

/**
 * Variants, certifications, badges and the panel.
 *
 * Variants are reconciled rather than replaced: a row the payload names by id is updated, a row it
 * omits is deleted, a row without an id is created. Deleting and re-inserting them all would issue
 * new ids on every save, and an id that changes is an id that `order_items` and `wishlist_items`
 * have already written down.
 */
async function writeChildren(
  tx: DbExecutor,
  productId: number,
  input: AdminProductInput,
): Promise<void> {
  const keptIds = input.variants
    .map((variant) => variant.id)
    .filter((id): id is number => id !== undefined);

  // Anything not in the payload goes. `order_items.variant_id` is ON DELETE SET NULL, so a line
  // somebody once bought keeps its own snapshot of name, SKU and price.
  await tx
    .delete(productVariants)
    .where(
      keptIds.length === 0
        ? eq(productVariants.productId, productId)
        : and(eq(productVariants.productId, productId), notInArray(productVariants.id, keptIds)),
    );

  /**
   * The SKU check runs *here*, after the delete above and before any insert.
   *
   * Asking earlier gets the wrong answer: a payload that drops the 5 lb variant and adds a new row
   * carrying its SKU is legitimate - the old row is gone by the time the new one lands - but a
   * check that ran before the delete would see the doomed row and call it a clash. The question is
   * "is this SKU taken by something that will still exist", and only this point in the transaction
   * can answer it.
   */
  await assertSkusFree(tx, input, productId);

  for (const variant of input.variants) {
    const columns = {
      productId,
      sku: variant.sku,
      weightValueMilli: variant.weightValueMilli,
      weightUnit: variant.weightUnit,
      weightLabel: variant.weightLabel,
      weightGrams: variant.weightGrams,
      priceCents: variant.priceCents,
      compareAtPriceCents: variant.compareAtPriceCents ?? null,
      costCents: variant.costCents ?? null,
      stockQty: variant.stockQty,
      lowStockThreshold: variant.lowStockThreshold,
      position: variant.position,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
    };

    if (variant.id === undefined) {
      await tx.insert(productVariants).values(columns);
    } else {
      await tx.update(productVariants).set(columns).where(eq(productVariants.id, variant.id));
    }
  }

  // Certifications and badges are sets, not rows with identity: replacing them wholesale is the
  // simplest correct thing, and nothing else references them.
  await tx.delete(productCertifications).where(eq(productCertifications.productId, productId));
  if (input.certifications.length > 0) {
    await tx
      .insert(productCertifications)
      .values(
        [...new Set(input.certifications)].map((certification) => ({ productId, certification })),
      );
  }

  await tx.delete(productBadges).where(eq(productBadges.productId, productId));
  if (input.badges.length > 0) {
    await tx
      .insert(productBadges)
      .values([...new Set(input.badges)].map((badge) => ({ productId, badge })));
  }

  await writeNutrition(tx, productId, input.nutrition ?? null);
}

async function writeNutrition(
  tx: DbExecutor,
  productId: number,
  panel: AdminNutritionInput | null,
): Promise<void> {
  if (panel === null) {
    // Clearing the panel is a real thing to want: a product whose label nobody has read is better
    // off with no panel than with figures somebody guessed.
    await tx.delete(productNutrition).where(eq(productNutrition.productId, productId));
    return;
  }

  const columns = {
    productId,
    servingSize: panel.servingSize,
    servingsPerContainer: panel.servingsPerContainer ?? null,
    calories: panel.calories,
    fatMg: panel.fatMg,
    satFatMg: panel.satFatMg,
    carbsMg: panel.carbsMg,
    sugarsMg: panel.sugarsMg,
    fiberMg: panel.fiberMg,
    proteinMg: panel.proteinMg,
    sodiumMg: panel.sodiumMg,
    ingredientsText: panel.ingredientsText,
    allergensText: panel.allergensText ?? null,
    // The form is the only writer of `entered`. Anything that came through here was typed by a
    // person from a packet, which is the whole distinction decision D-20 asked for.
    source: 'entered' as const,
  };

  await tx.delete(productNutrition).where(eq(productNutrition.productId, productId));
  await tx.insert(productNutrition).values(columns);
}

async function assertCategoryExists(tx: DbExecutor, categoryId: number): Promise<void> {
  const [category] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId));
  // A foreign key would catch this too, as a 500. A 422 naming the field is what the form can act on.
  if (!category) {
    throw new AppError('VALIDATION_FAILED', 'That category does not exist', {
      details: [{ path: 'categoryId', message: 'Unknown category' }],
    });
  }
}

async function assertSlugFree(
  tx: DbExecutor,
  slug: string,
  exceptId: number | null,
): Promise<void> {
  const rows = await tx.select({ id: products.id }).from(products).where(eq(products.slug, slug));
  const clash = rows.find((row) => row.id !== exceptId);
  if (clash) {
    // The slug is the product's public address. A duplicate would be a unique-index 500 otherwise,
    // and the editor would have no idea which field to change.
    throw new AppError('CONFLICT', `Another product already uses the slug "${slug}"`, {
      details: [{ path: 'slug', message: 'Already taken' }],
    });
  }
}

/**
 * SKUs are unique across the whole catalogue, not per product.
 *
 * They end up on packing slips and in the admin's own search, so two products sharing one is a
 * warehouse problem rather than a data-model nicety.
 */
async function assertSkusFree(
  tx: DbExecutor,
  input: AdminProductInput,
  productId: number,
): Promise<void> {
  const skus = input.variants.map((variant) => variant.sku);
  const rows = await tx
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      productId: productVariants.productId,
    })
    .from(productVariants)
    .where(inArray(productVariants.sku, skus));

  const ownIds = new Set(
    input.variants.map((variant) => variant.id).filter((id): id is number => id !== undefined),
  );
  const clash = rows.find((row) => row.productId !== productId || !ownIds.has(row.id));

  if (clash) {
    throw new AppError('CONFLICT', `The SKU "${clash.sku}" is already in use`, {
      details: [{ path: 'variants', message: `SKU ${clash.sku} is already in use` }],
    });
  }
}
