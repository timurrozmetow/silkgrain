import type { AdminImageArrangement, AdminProductImage } from '@silkgrain/contracts';
import { and, asc, eq, max } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { productImages, products } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import { processImage } from '../media/image.service';
import type { Storage } from '../media/storage.service';

import type { AdminActor } from './actor';
import { type AuditContext, recordAudit } from './audit.service';

/**
 * Managing a product's images.
 *
 * The bytes live in object storage; the rows here are what own them - order, alt text, which is
 * primary. The database is the source of truth for what exists, and the bucket is a cache of the
 * pixels, which is why a delete removes the row first and the object second, best-effort.
 */

async function assertProduct(
  db: Database,
  productId: number,
): Promise<{ id: number; name: string }> {
  const [row] = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.id, productId));
  if (!row) throw notFound('Product');
  return row;
}

export async function listImages(db: Database, productId: number): Promise<AdminProductImage[]> {
  const rows = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.position), asc(productImages.id));

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    alt: row.alt,
    width: row.width,
    height: row.height,
    position: row.position,
    isPrimary: row.isPrimary,
  }));
}

/**
 * Processes an upload and appends it to the product's images.
 *
 * The first image a product gets is its primary - a product needs one, and defaulting to the only
 * candidate spares the editor a click they would always make. Later uploads land at the end and
 * primary stays where it was.
 */
export async function addImage(
  db: Database,
  storage: Storage,
  productId: number,
  file: Buffer,
  alt: string,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminProductImage[]> {
  const product = await assertProduct(db, productId);

  const processed = await processImage(file);
  const url = await storage.put(processed.key, processed.body, processed.contentType);

  const [tail] = await db
    .select({ maxPosition: max(productImages.position) })
    .from(productImages)
    .where(eq(productImages.productId, productId));
  const [existing] = await db
    .select({ id: productImages.id })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .limit(1);

  await db.transaction(async (tx) => {
    await tx.insert(productImages).values({
      productId,
      url,
      alt: alt.slice(0, 300),
      width: processed.width,
      height: processed.height,
      position: (tail?.maxPosition ?? -1) + 1,
      isPrimary: existing === undefined,
    });

    await recordAudit(tx, actor, context, {
      action: 'product.image_added',
      entityId: productId,
      entityLabel: product.name,
      before: null,
      after: { url, alt: alt.slice(0, 300), isPrimary: existing === undefined },
    });
  });

  return listImages(db, productId);
}

/**
 * Applies an order and a primary in one transaction.
 *
 * `order` must be exactly the product's images - no strangers, none missing. Applying a partial
 * arrangement would renumber some rows and leave others, which is a worse state than the request
 * that asked for it, so the whole thing is checked before anything is written.
 */
export async function arrangeImages(
  db: Database,
  productId: number,
  input: AdminImageArrangement,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminProductImage[]> {
  const product = await assertProduct(db, productId);

  const owned = await db
    .select({ id: productImages.id, isPrimary: productImages.isPrimary })
    .from(productImages)
    .where(eq(productImages.productId, productId));
  const ownedIds = new Set(owned.map((row) => row.id));
  const previousPrimary = owned.find((row) => row.isPrimary)?.id ?? null;

  const orderedIds = new Set(input.order);
  const sameSize = orderedIds.size === input.order.length && orderedIds.size === ownedIds.size;
  const allOwned = input.order.every((id) => ownedIds.has(id));
  if (!sameSize || !allOwned || !ownedIds.has(input.primaryId)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The image order must list every image of this product exactly once',
    );
  }

  await db.transaction(async (tx) => {
    for (let position = 0; position < input.order.length; position += 1) {
      const id = input.order[position];
      if (id === undefined) continue;
      await tx
        .update(productImages)
        .set({ position, isPrimary: id === input.primaryId })
        .where(and(eq(productImages.id, id), eq(productImages.productId, productId)));
    }

    await recordAudit(tx, actor, context, {
      action: 'product.images_arranged',
      entityId: productId,
      entityLabel: product.name,
      before: { order: owned.map((row) => row.id).join(','), primaryId: previousPrimary },
      after: { order: input.order.join(','), primaryId: input.primaryId },
    });
  });

  return listImages(db, productId);
}

export async function setImageAlt(
  db: Database,
  productId: number,
  imageId: number,
  alt: string,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminProductImage[]> {
  const product = await assertProduct(db, productId);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(productImages)
      .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
      .for('update');
    // Absent when the image is not this product's - a 404 rather than a silent no-op.
    if (!row) throw notFound('Image');
    if (row.alt === alt) return;

    await tx.update(productImages).set({ alt }).where(eq(productImages.id, imageId));
    await recordAudit(tx, actor, context, {
      action: 'product.image_updated',
      entityId: productId,
      entityLabel: product.name,
      before: { alt: row.alt },
      after: { alt },
    });
  });

  return listImages(db, productId);
}

/**
 * Removes an image, and hands the primary flag on if it was the one that carried it.
 *
 * A product with images must have exactly one primary, so deleting the primary promotes whatever is
 * now first rather than leaving the product with none. The object is deleted after the row,
 * best-effort - an orphaned blob is cheap, a blocked delete is not.
 */
export async function removeImage(
  db: Database,
  storage: Storage,
  productId: number,
  imageId: number,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminProductImage[]> {
  const product = await assertProduct(db, productId);
  const [image] = await db
    .select()
    .from(productImages)
    .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)));
  if (!image) throw notFound('Image');

  await db.transaction(async (tx) => {
    await tx.delete(productImages).where(eq(productImages.id, imageId));

    if (image.isPrimary) {
      const [next] = await tx
        .select({ id: productImages.id })
        .from(productImages)
        .where(eq(productImages.productId, productId))
        .orderBy(asc(productImages.position), asc(productImages.id))
        .limit(1);
      if (next) {
        await tx
          .update(productImages)
          .set({ isPrimary: true })
          .where(eq(productImages.id, next.id));
      }
    }

    await recordAudit(tx, actor, context, {
      action: 'product.image_removed',
      entityId: productId,
      entityLabel: product.name,
      before: { url: image.url, alt: image.alt, isPrimary: image.isPrimary },
      after: null,
    });
  });

  await storage.remove(image.url);
  return listImages(db, productId);
}
