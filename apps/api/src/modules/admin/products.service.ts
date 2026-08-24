import {
  type AdminProductListQuery,
  type AdminProductListResponse,
  type AdminProductRow,
  pageBounds,
  pageMeta,
} from '@silkgrain/contracts';
import { and, asc, count, eq, inArray, like, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  categories,
  productImages,
  productNutrition,
  productVariants,
  products,
} from '../../db/schema';
import { likePattern } from '../catalog/catalog.query';

/**
 * The admin's product list.
 *
 * Deliberately not `listProducts` from the catalogue service. That one starts from
 * `PUBLISHED_PRODUCT` and exists to hide what a customer must not see; this one exists to show an
 * editor everything, drafts and archived rows included. Sharing the query would mean a flag that
 * turns the storefront's safety off, and that flag would eventually be passed by mistake.
 *
 * Two steps rather than one join: the id query decides which products and in what order, then the
 * aggregates are fetched for those ids. A join across variants would multiply each product by its
 * variants and make `COUNT` and `SUM` describe the join rather than the product.
 */
export async function listAdminProducts(
  db: Database,
  query: AdminProductListQuery,
): Promise<AdminProductListResponse> {
  const { limit, offset } = pageBounds(query);
  const conditions: SQL[] = [];

  if (query.status !== 'all') conditions.push(eq(products.status, query.status));

  if (query.category !== undefined) {
    conditions.push(eq(categories.slug, query.category));
  }

  if (query.q !== undefined && query.q.length > 0) {
    const pattern = likePattern(query.q);
    // SKU is in here and not in the storefront's search: an editor looking for a product usually
    // has the SKU in front of them, off a packing slip or a supplier's invoice.
    const match = or(
      like(products.name, pattern),
      like(products.slug, pattern),
      sql`EXISTS (SELECT 1 FROM ${productVariants}
        WHERE ${productVariants.productId} = ${products.id}
        AND ${productVariants.sku} LIKE ${pattern})`,
    );
    if (match) conditions.push(match);
  }

  if (query.lowStock === true) {
    // The dashboard's definition, so the two panels cannot disagree about what "low" is.
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${productVariants}
        WHERE ${productVariants.productId} = ${products.id}
        AND ${productVariants.isActive} = TRUE
        AND ${productVariants.stockQty} <= ${productVariants.lowStockThreshold})`,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        status: products.status,
        categoryName: categories.name,
        isFeatured: products.isFeatured,
        updatedAt: products.updatedAt,
        nutritionSource: productNutrition.source,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(productNutrition, eq(productNutrition.productId, products.id))
      .where(where)
      // Most recently touched first: an editor's next action is usually on what they just saved.
      .orderBy(sql`${products.updatedAt} DESC`, asc(products.id))
      .limit(limit)
      .offset(offset),

    db
      .select({ total: count() })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(where),
  ]);

  const ids = rows.map((row) => row.id);
  const [aggregates, images] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select({
            productId: productVariants.productId,
            variantCount: count(),
            // Active variants only for the price - an editor sees the "from" a customer would.
            priceFrom: sql<string | null>`MIN(CASE WHEN ${productVariants.isActive} = TRUE
              THEN ${productVariants.priceCents} END)`,
            // Every variant for the stock, active or not: retired stock is still on a shelf.
            stockTotal: sql<string>`COALESCE(SUM(${productVariants.stockQty}), 0)`,
          })
          .from(productVariants)
          .where(inArray(productVariants.productId, ids))
          .groupBy(productVariants.productId),

    ids.length === 0
      ? Promise.resolve([])
      : db
          .select({
            productId: productImages.productId,
            url: productImages.url,
            isPrimary: productImages.isPrimary,
            position: productImages.position,
          })
          .from(productImages)
          .where(inArray(productImages.productId, ids))
          .orderBy(asc(productImages.position), asc(productImages.id)),
  ]);

  const items: AdminProductRow[] = rows.map((row) => {
    const aggregate = aggregates.find((entry) => entry.productId === row.id);
    const image =
      images.find((entry) => entry.productId === row.id && entry.isPrimary) ??
      images.find((entry) => entry.productId === row.id);

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      categoryName: row.categoryName,
      imageUrl: image?.url ?? null,
      variantCount: aggregate?.variantCount ?? 0,
      // `MIN` over an empty CASE is NULL, which is the honest answer for a product with no
      // sellable variant rather than a zero that reads as "free".
      priceFromCents:
        aggregate?.priceFrom === null || aggregate?.priceFrom === undefined
          ? null
          : Number(aggregate.priceFrom),
      stockTotal: Number(aggregate?.stockTotal ?? 0),
      isFeatured: row.isFeatured,
      nutritionSource: row.nutritionSource,
      updatedAt: row.updatedAt.toISOString(),
    };
  });

  return { items, meta: pageMeta(query.page, query.perPage, totals?.total ?? 0) };
}
