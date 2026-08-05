import {
  type Badge,
  BADGE,
  CART_LINE_MAX_QTY,
  CERTIFICATION,
  type CategoryListResponse,
  type CategoryNode,
  type Certification,
  ORIGIN,
  type ProductCard,
  type ProductDetailResponse,
  type ProductFacets,
  type ProductListQuery,
  type ProductListResponse,
  type ProductVariantView,
  type ReviewBreakdown,
  type SearchSuggestResponse,
  type StockState,
  pageMeta,
} from '@silkgrain/contracts';
import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  inArray,
  max,
  min,
  ne,
  notInArray,
  sql,
} from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  categories,
  productBadges,
  productCertifications,
  productImages,
  productNutrition,
  productVariants,
  products,
  reviews,
} from '../../db/schema';
import { notFound } from '../../lib/errors';

import {
  PRICE_FROM,
  PUBLISHED_PRODUCT,
  buildProductConditions,
  filtersFrom,
  likePattern,
  orderFor,
  type ProductFilterInput,
} from './catalog.query';

/**
 * The read side of the catalogue.
 *
 * Every list is assembled in two steps: one query decides *which* products and in what order,
 * then a handful of `IN (...)` queries fetch the rows those products need. The alternative -
 * one join returning products times variants times images times badges - hands MySQL a
 * cartesian product to de-duplicate and hands this file a row shape nobody can read.
 */

/** Four is what "You May Also Like" draws, and what the mega-menu's featured slot needs. */
const RELATED_LIMIT = 4;
/** The Reviews tab lists this many; the histogram always covers every published review. */
const REVIEW_PAGE_SIZE = 20;
/** Chips shown while the search field is empty. */
const POPULAR_TERM_COUNT = 6;

// --------------------------------------------------------------------------------------
// Categories
// --------------------------------------------------------------------------------------

/**
 * The tree the mega-menu and the shop sidebar render.
 *
 * Counts are computed here rather than stored, and they count exactly what the grid would
 * show - an active product with at least one active variant. A category advertising 18 items
 * that lists 17 is the kind of discrepancy nobody reports and everybody notices.
 */
export async function listCategories(db: Database): Promise<CategoryListResponse> {
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
      icon: categories.icon,
      imageUrl: categories.imageUrl,
      parentId: categories.parentId,
      position: categories.position,
    })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.position), asc(categories.name));

  const counts = await countProductsByCategory(db);

  const summaryOf = (row: (typeof rows)[number], count: number) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    imageUrl: row.imageUrl,
    productCount: count,
  });

  const childrenOf = new Map<number, typeof rows>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const siblings = childrenOf.get(row.parentId) ?? [];
    siblings.push(row);
    childrenOf.set(row.parentId, siblings);
  }

  const items: CategoryNode[] = rows
    .filter((row) => row.parentId === null)
    .map((row) => {
      const children = childrenOf.get(row.id) ?? [];
      // A parent's count includes its children's: clicking "Rice" in the mega-menu filters to
      // the whole branch, so the number beside it has to describe the whole branch.
      const own = counts.get(row.id) ?? 0;
      const total = children.reduce((sum, child) => sum + (counts.get(child.id) ?? 0), own);
      return {
        ...summaryOf(row, total),
        children: children.map((child) => summaryOf(child, counts.get(child.id) ?? 0)),
      };
    });

  return { items };
}

async function countProductsByCategory(db: Database): Promise<Map<number, number>> {
  const rows = await db
    .select({ categoryId: products.categoryId, total: countDistinct(products.id) })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(productVariants, purchasableVariant())
    .where(and(...PUBLISHED_PRODUCT))
    .groupBy(products.categoryId);

  return new Map(rows.map((row) => [row.categoryId, row.total]));
}

/**
 * Lightest first, with the unweighable last.
 *
 * Sorted here rather than in SQL because `SELECT DISTINCT` may only order by expressions it
 * also selects, and because MySQL puts NULL first ascending - which would open the sidebar's
 * weight list with "1 kit", the one entry that is a count rather than a weight.
 */
function sortWeights<Row extends { label: string; grams: number | null }>(rows: Row[]): Row[] {
  return [...rows].sort((left, right) => {
    if (left.grams === null || right.grams === null) {
      if (left.grams === right.grams) return left.label.localeCompare(right.label);
      return left.grams === null ? 1 : -1;
    }
    return left.grams - right.grams || left.label.localeCompare(right.label);
  });
}

/** The join every listing uses: a product is in the catalogue only if something is buyable. */
function purchasableVariant() {
  return and(eq(productVariants.productId, products.id), eq(productVariants.isActive, true));
}

/** Resolves category slugs to ids, folding in the children of any parent that was named. */
async function resolveCategoryIds(db: Database, slugs: string[]): Promise<number[]> {
  const named = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.isActive, true), inArray(categories.slug, slugs)));
  if (named.length === 0) return [];

  const ids = named.map((row) => row.id);
  const children = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.isActive, true), inArray(categories.parentId, ids)));

  return [...new Set([...ids, ...children.map((row) => row.id)])];
}

// --------------------------------------------------------------------------------------
// Product list
// --------------------------------------------------------------------------------------

export async function listProducts(
  db: Database,
  query: ProductListQuery,
): Promise<ProductListResponse> {
  const categoryIds =
    query.category && query.category.length > 0
      ? await resolveCategoryIds(db, query.category)
      : undefined;
  const filters = filtersFrom(query, categoryIds);

  const conditions = buildProductConditions(db, filters);
  const offset = (query.page - 1) * query.perPage;

  const ordered = await db
    .select({
      id: products.id,
      // Selected as well as ordered on: MySQL 8 would accept ordering by a column functionally
      // dependent on the grouping key, but naming them here makes the query legal under any
      // `sql_mode` and costs nothing.
      isFeatured: products.isFeatured,
      soldCount: products.soldCount,
      publishedAt: products.publishedAt,
      ratingTotal: products.ratingTotal,
      reviewCount: products.reviewCount,
      priceFrom: PRICE_FROM,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(productVariants, purchasableVariant())
    .where(and(...conditions))
    .groupBy(products.id)
    .orderBy(...orderFor(query.sort))
    .limit(query.perPage)
    .offset(offset);

  const [totals] = await db
    .select({ total: countDistinct(products.id) })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(productVariants, purchasableVariant())
    .where(and(...conditions));

  const [items, facets] = await Promise.all([
    loadCards(
      db,
      ordered.map((row) => row.id),
    ),
    loadFacets(db, filters),
  ]);

  return {
    items,
    meta: pageMeta(query.page, query.perPage, totals?.total ?? 0),
    facets,
  };
}

/**
 * Sidebar counts and slider bounds.
 *
 * Each facet is computed with its own filter removed. Ticking "Rice" must not collapse every
 * other category to zero - the customer would have no way back except the Reset link - and the
 * price slider's own handles must not keep shrinking the track they sit on.
 */
async function loadFacets(db: Database, filters: ProductFilterInput): Promise<ProductFacets> {
  const withoutCategory = buildProductConditions(db, filters, { category: true });
  const withoutPrice = buildProductConditions(db, filters, { price: true });
  const withoutWeight = buildProductConditions(db, filters, { weight: true });
  const withoutOrigin = buildProductConditions(db, filters, { origin: true });
  const withoutCert = buildProductConditions(db, filters, { cert: true });

  const [countRows, priceRows, tree, weightRows, originRows, certRows, weightUniverse] =
    await Promise.all([
      db
        .select({ categoryId: products.categoryId, total: countDistinct(products.id) })
        .from(products)
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .innerJoin(productVariants, purchasableVariant())
        .where(and(...withoutCategory))
        .groupBy(products.categoryId),
      db
        .select({
          minCents: min(productVariants.priceCents),
          maxCents: max(productVariants.priceCents),
        })
        .from(products)
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .innerJoin(productVariants, purchasableVariant())
        .where(and(...withoutPrice)),
      db
        .select({
          id: categories.id,
          slug: categories.slug,
          name: categories.name,
          parentId: categories.parentId,
        })
        .from(categories)
        .where(eq(categories.isActive, true))
        .orderBy(asc(categories.position), asc(categories.name)),
      db
        .select({ label: productVariants.weightLabel, total: countDistinct(products.id) })
        .from(products)
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .innerJoin(productVariants, purchasableVariant())
        .where(and(...withoutWeight))
        .groupBy(productVariants.weightLabel),
      db
        .select({ value: products.origin, total: countDistinct(products.id) })
        .from(products)
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .innerJoin(productVariants, purchasableVariant())
        .where(and(...withoutOrigin))
        .groupBy(products.origin),
      db
        .select({
          value: productCertifications.certification,
          total: countDistinct(products.id),
        })
        .from(products)
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .innerJoin(productVariants, purchasableVariant())
        .innerJoin(productCertifications, eq(productCertifications.productId, products.id))
        .where(and(...withoutCert))
        .groupBy(productCertifications.certification),
      // The set of labels the checkbox list is drawn from, and the order it is drawn in.
      // Taken over the whole catalogue rather than the current result, so a value that no
      // longer matches shows a zero instead of vanishing from the sidebar.
      db
        .selectDistinct({
          label: productVariants.weightLabel,
          grams: productVariants.weightGrams,
        })
        .from(products)
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .innerJoin(productVariants, purchasableVariant())
        .where(and(...PUBLISHED_PRODUCT)),
    ]);

  const counts = new Map(countRows.map((row) => [row.categoryId, row.total]));

  /**
   * Top level only, with children folded in.
   *
   * The sidebar draws six cards and the mega-menu six tiles; both are the top level, and both
   * must agree with the tree endpoint - a category that says 2 in one place and 1 in the other
   * is a bug report waiting to happen. Sub-categories are reached from the category screen's
   * chips, which filter by the child slug.
   *
   * Categories that currently match nothing are kept at zero rather than dropped, so the
   * sidebar does not reflow every time a checkbox is ticked.
   */
  const items = tree
    .filter((category) => category.parentId === null)
    .map((category) => {
      const own = counts.get(category.id) ?? 0;
      const fromChildren = tree
        .filter((child) => child.parentId === category.id)
        .reduce((sum, child) => sum + (counts.get(child.id) ?? 0), 0);
      return { slug: category.slug, name: category.name, count: own + fromChildren };
    });

  // The universe of each remaining facet is fixed - the two enums, and every weight label the
  // catalogue actually uses - so a value at zero stays in the list rather than disappearing.
  const weightCounts = new Map(weightRows.map((row) => [row.label, row.total]));
  const originCounts = new Map(originRows.map((row) => [row.value, row.total]));
  const certCounts = new Map(certRows.map((row) => [row.value, row.total]));

  const bounds = priceRows[0];
  return {
    categories: items,
    weights: sortWeights(weightUniverse).map((row) => ({
      label: row.label,
      count: weightCounts.get(row.label) ?? 0,
    })),
    origins: ORIGIN.map((value) => ({ value, count: originCounts.get(value) ?? 0 })),
    certifications: CERTIFICATION.map((value) => ({
      value,
      count: certCounts.get(value) ?? 0,
    })),
    price: {
      minCents: bounds?.minCents ?? 0,
      maxCents: bounds?.maxCents ?? 0,
    },
  };
}

// --------------------------------------------------------------------------------------
// Card assembly
// --------------------------------------------------------------------------------------

interface VariantRow {
  id: number;
  productId: number;
  sku: string;
  weightLabel: string;
  weightUnit: ProductVariantView['weightUnit'];
  weightGrams: number | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  stockQty: number;
  lowStockThreshold: number;
  isDefault: boolean;
}

/**
 * Loads the cards for a set of ids and returns them in exactly that order.
 *
 * The order matters: the id query is what applied the sort, and re-sorting here - or letting
 * MySQL's `IN (...)` order stand - would silently discard it.
 */
async function loadCards(db: Database, ids: number[]): Promise<ProductCard[]> {
  if (ids.length === 0) return [];

  const [rows, variants, images, badges, certs] = await Promise.all([
    db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        blurb: products.blurb,
        origin: products.origin,
        tone: products.tone,
        icon: products.icon,
        isFeatured: products.isFeatured,
        ratingTotal: products.ratingTotal,
        reviewCount: products.reviewCount,
        categorySlug: categories.slug,
        categoryName: categories.name,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(inArray(products.id, ids)),
    loadVariants(db, ids),
    db
      .select({
        productId: productImages.productId,
        url: productImages.url,
        alt: productImages.alt,
        isPrimary: productImages.isPrimary,
      })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(desc(productImages.isPrimary), asc(productImages.position), asc(productImages.id)),
    db
      .select({ productId: productBadges.productId, badge: productBadges.badge })
      .from(productBadges)
      .where(inArray(productBadges.productId, ids)),
    db
      .select({
        productId: productCertifications.productId,
        certification: productCertifications.certification,
      })
      .from(productCertifications)
      .where(inArray(productCertifications.productId, ids)),
  ]);

  const variantsBy = groupBy(variants, (row) => row.productId);
  const imagesBy = groupBy(images, (row) => row.productId);
  const badgesBy = groupBy(badges, (row) => row.productId);
  const certsBy = groupBy(certs, (row) => row.productId);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const cards: ProductCard[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    const productVariantRows = variantsBy.get(id) ?? [];
    // A product whose last active variant was retired between the two queries has no price to
    // show and no default to add to a cart, so it drops out rather than rendering as "$0".
    if (!row || productVariantRows.length === 0) continue;

    const image = imagesBy.get(id)?.[0];
    const certifications = (certsBy.get(id) ?? []).map((entry) => entry.certification);
    const editorial = (badgesBy.get(id) ?? []).map((entry) => entry.badge);

    cards.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      blurb: row.blurb,
      category: { slug: row.categorySlug, name: row.categoryName },
      image: image ? { url: image.url, alt: image.alt } : null,
      tone: row.tone,
      icon: row.icon,
      badges: deriveBadges(editorial, certifications, productVariantRows),
      rating: ratingOf(row.ratingTotal, row.reviewCount),
      stockState: stockStateOf(productVariantRows),
      origin: row.origin,
      weightLabels: productVariantRows.map((variant) => variant.weightLabel),
      priceFromCents: Math.min(...productVariantRows.map((variant) => variant.priceCents)),
      priceToCents: Math.max(...productVariantRows.map((variant) => variant.priceCents)),
      defaultVariantId: defaultVariantOf(productVariantRows).id,
      currency: 'USD',
      isFeatured: row.isFeatured,
    });
  }

  return cards;
}

function loadVariants(db: Database, ids: number[]): Promise<VariantRow[]> {
  return db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
      weightLabel: productVariants.weightLabel,
      weightUnit: productVariants.weightUnit,
      weightGrams: productVariants.weightGrams,
      priceCents: productVariants.priceCents,
      compareAtPriceCents: productVariants.compareAtPriceCents,
      stockQty: productVariants.stockQty,
      lowStockThreshold: productVariants.lowStockThreshold,
      isDefault: productVariants.isDefault,
    })
    .from(productVariants)
    .where(and(inArray(productVariants.productId, ids), eq(productVariants.isActive, true)))
    .orderBy(asc(productVariants.position), asc(productVariants.id));
}

/**
 * Decision D-12 made concrete: three badges are stored, two are facts about other columns.
 *
 * The order is the enum's, not the database's, so the same product always renders its badges
 * in the same sequence no matter what order the rows came back in.
 */
function deriveBadges(
  editorial: readonly Badge[],
  certifications: readonly Certification[],
  variants: readonly VariantRow[],
): Badge[] {
  const present = new Set<Badge>(editorial);
  if (variants.some((variant) => variant.compareAtPriceCents !== null)) present.add('sale');
  if (certifications.includes('organic')) present.add('organic');
  return BADGE.filter((badge) => present.has(badge));
}

/** `in` if anything is comfortably stocked, `low` if only thin stock is left, `out` if none. */
function stockStateOf(variants: readonly VariantRow[]): StockState {
  let best = 0;
  for (const variant of variants) {
    const state = variant.stockQty <= 0 ? 0 : variant.stockQty <= variant.lowStockThreshold ? 1 : 2;
    if (state > best) best = state;
  }
  return best === 2 ? 'in' : best === 1 ? 'low' : 'out';
}

function defaultVariantOf(variants: readonly VariantRow[]): VariantRow {
  const flagged = variants.find((variant) => variant.isDefault);
  // `variants` is never empty at this point - the caller drops products without one - and the
  // non-null assertion the compiler would otherwise need is worse than this fallback.
  const first = flagged ?? variants[0];
  if (!first) throw new Error('loadCards: asked for the default variant of a product with none');
  return first;
}

function ratingOf(total: number, count: number): { average: number; count: number } | null {
  if (count <= 0) return null;
  return { average: Math.round((total / count) * 10) / 10, count };
}

function groupBy<Row, Key>(rows: readonly Row[], keyOf: (row: Row) => Key): Map<Key, Row[]> {
  const grouped = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

// --------------------------------------------------------------------------------------
// Product detail
// --------------------------------------------------------------------------------------

export async function getProductBySlug(db: Database, slug: string): Promise<ProductDetailResponse> {
  const [row] = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      subtitle: products.subtitle,
      blurb: products.blurb,
      description: products.description,
      story: products.story,
      origin: products.origin,
      originRegion: products.originRegion,
      status: products.status,
      tone: products.tone,
      icon: products.icon,
      isFeatured: products.isFeatured,
      ratingTotal: products.ratingTotal,
      reviewCount: products.reviewCount,
      metaTitle: products.metaTitle,
      metaDescription: products.metaDescription,
      publishedAt: products.publishedAt,
      categoryId: products.categoryId,
      categorySlug: categories.slug,
      categoryName: categories.name,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.slug, slug), ...PUBLISHED_PRODUCT));

  if (!row) throw notFound('Product');

  const [cards, variants, images, nutritionRows, breakdown, related, certifications] =
    await Promise.all([
      loadCards(db, [row.id]),
      loadVariants(db, [row.id]),
      db
        .select({
          url: productImages.url,
          alt: productImages.alt,
          width: productImages.width,
          height: productImages.height,
          isPrimary: productImages.isPrimary,
        })
        .from(productImages)
        .where(eq(productImages.productId, row.id))
        .orderBy(desc(productImages.isPrimary), asc(productImages.position), asc(productImages.id)),
      db.select().from(productNutrition).where(eq(productNutrition.productId, row.id)),
      loadReviewBreakdown(db, row.id),
      loadRelated(db, row.id, row.categoryId),
      loadCertifications(db, row.id),
    ]);

  const card = cards[0];
  if (!card || variants.length === 0) throw notFound('Product');

  const nutrition = nutritionRows[0];

  return {
    product: {
      ...card,
      subtitle: row.subtitle,
      description: row.description,
      story: row.story,
      originRegion: row.originRegion,
      status: row.status,
      images: images.map((image) => ({
        url: image.url,
        alt: image.alt,
        width: image.width,
        height: image.height,
        isPrimary: image.isPrimary,
      })),
      variants: variants.map(toVariantView),
      certifications,
      nutrition: nutrition
        ? {
            servingSize: nutrition.servingSize,
            servingsPerContainer: nutrition.servingsPerContainer,
            calories: nutrition.calories,
            fatMg: nutrition.fatMg,
            satFatMg: nutrition.satFatMg,
            carbsMg: nutrition.carbsMg,
            sugarsMg: nutrition.sugarsMg,
            fiberMg: nutrition.fiberMg,
            proteinMg: nutrition.proteinMg,
            sodiumMg: nutrition.sodiumMg,
            ingredientsText: nutrition.ingredientsText,
            allergensText: nutrition.allergensText,
          }
        : null,
      // The card carries the stored aggregate, which is the fast path for a grid of sixteen.
      // On the detail page the histogram is right there beside it, so both come from the
      // published rows and the page cannot contradict itself.
      rating: breakdown.count > 0 ? { average: breakdown.average, count: breakdown.count } : null,
      reviews: breakdown,
      seo: { metaTitle: row.metaTitle, metaDescription: row.metaDescription },
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    },
    related,
  };
}

function toVariantView(variant: VariantRow): ProductVariantView {
  const stockState: StockState =
    variant.stockQty <= 0 ? 'out' : variant.stockQty <= variant.lowStockThreshold ? 'low' : 'in';
  return {
    id: variant.id,
    sku: variant.sku,
    weightLabel: variant.weightLabel,
    weightUnit: variant.weightUnit,
    weightGrams: variant.weightGrams,
    priceCents: variant.priceCents,
    compareAtPriceCents: variant.compareAtPriceCents,
    currency: 'USD',
    stockState,
    availableQty: Math.min(Math.max(variant.stockQty, 0), CART_LINE_MAX_QTY),
    isDefault: variant.isDefault,
  };
}

async function loadCertifications(db: Database, productId: number): Promise<Certification[]> {
  const rows = await db
    .select({ certification: productCertifications.certification })
    .from(productCertifications)
    .where(eq(productCertifications.productId, productId));
  return rows.map((row) => row.certification);
}

/**
 * The five-star histogram and the reviews behind it.
 *
 * Only `published` rows are counted. A moderation queue that leaked into the average would
 * make the rating on the page move every time somebody submitted anything.
 */
async function loadReviewBreakdown(db: Database, productId: number): Promise<ReviewBreakdown> {
  const published = and(eq(reviews.productId, productId), eq(reviews.status, 'published'));

  const [histogramRows, items] = await Promise.all([
    db
      .select({ rating: reviews.rating, total: countDistinct(reviews.id) })
      .from(reviews)
      .where(published)
      .groupBy(reviews.rating),
    db
      .select({
        id: reviews.id,
        authorName: reviews.authorName,
        rating: reviews.rating,
        title: reviews.title,
        body: reviews.body,
        isVerifiedPurchase: reviews.isVerifiedPurchase,
        publishedAt: reviews.publishedAt,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .where(published)
      .orderBy(desc(reviews.publishedAt), desc(reviews.id))
      .limit(REVIEW_PAGE_SIZE),
  ]);

  const histogram = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let count = 0;
  let total = 0;
  for (const row of histogramRows) {
    const star = String(row.rating) as keyof typeof histogram;
    if (!(star in histogram)) continue;
    const rowCount = row.total;
    histogram[star] = rowCount;
    count += rowCount;
    total += rowCount * row.rating;
  }

  return {
    average: count > 0 ? Math.round((total / count) * 10) / 10 : 0,
    count,
    histogram,
    items: items.map((item) => ({
      id: item.id,
      authorName: item.authorName,
      rating: item.rating,
      title: item.title,
      body: item.body,
      isVerifiedPurchase: item.isVerifiedPurchase,
      // A published review always has a date; falling back to `created_at` keeps a row that
      // was published by hand in SQL from breaking the whole page.
      publishedAt: (item.publishedAt ?? item.createdAt).toISOString(),
    })),
  };
}

/** Same category first, topped up from the rest of the catalogue so the row is never short. */
async function loadRelated(
  db: Database,
  productId: number,
  categoryId: number,
): Promise<ProductCard[]> {
  const sameCategory = await db
    .select({ id: products.id })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(productVariants, purchasableVariant())
    .where(
      and(...PUBLISHED_PRODUCT, eq(products.categoryId, categoryId), ne(products.id, productId)),
    )
    .groupBy(products.id)
    .orderBy(desc(products.isFeatured), desc(products.soldCount), asc(products.id))
    .limit(RELATED_LIMIT);

  const ids = sameCategory.map((row) => row.id);

  if (ids.length < RELATED_LIMIT) {
    const exclude = [productId, ...ids];
    const fillers = await db
      .select({ id: products.id })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .innerJoin(productVariants, purchasableVariant())
      .where(
        and(
          ...PUBLISHED_PRODUCT,
          ne(products.categoryId, categoryId),
          notInArray(products.id, exclude),
        ),
      )
      .groupBy(products.id)
      .orderBy(desc(products.isFeatured), desc(products.soldCount), asc(products.id))
      .limit(RELATED_LIMIT - ids.length);
    ids.push(...fillers.map((row) => row.id));
  }

  return loadCards(db, ids);
}

// --------------------------------------------------------------------------------------
// Search suggestions
// --------------------------------------------------------------------------------------

export async function suggestProducts(
  db: Database,
  term: string | undefined,
  limit: number,
): Promise<SearchSuggestResponse> {
  // The overlay opens before anything is typed, and in that state it draws only the chips.
  if (term === undefined || term.length === 0) {
    return { items: [], popular: await loadPopularTerms(db) };
  }

  const pattern = likePattern(term);
  const matches = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      soldCount: products.soldCount,
      categoryName: categories.name,
      priceFrom: PRICE_FROM,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(productVariants, purchasableVariant())
    .where(
      and(
        ...PUBLISHED_PRODUCT,
        sql`(${products.name} LIKE ${pattern} OR ${products.blurb} LIKE ${pattern} OR ${categories.name} LIKE ${pattern})`,
      ),
    )
    .groupBy(products.id)
    .orderBy(desc(products.soldCount), asc(products.id))
    .limit(limit);

  const images =
    matches.length > 0
      ? await db
          .select({
            productId: productImages.productId,
            url: productImages.url,
          })
          .from(productImages)
          .where(
            inArray(
              productImages.productId,
              matches.map((row) => row.id),
            ),
          )
          .orderBy(
            desc(productImages.isPrimary),
            asc(productImages.position),
            asc(productImages.id),
          )
      : [];
  const imageBy = groupBy(images, (row) => row.productId);

  return {
    items: matches.map((row) => ({
      slug: row.slug,
      name: row.name,
      categoryName: row.categoryName,
      image: imageBy.get(row.id)?.[0]?.url ?? null,
      priceFromCents: row.priceFrom,
      currency: 'USD' as const,
    })),
    popular: await loadPopularTerms(db),
  };
}

/**
 * The chips shown before anything is typed.
 *
 * Derived from what actually sells rather than configured, because a hard-coded list goes
 * stale the first time the catalogue changes and nobody remembers where it lives. Real search
 * analytics would be better and are in `BACKLOG.md`; until there is a search-log table, the
 * best-selling names are the closest true answer available.
 */
async function loadPopularTerms(db: Database): Promise<string[]> {
  const rows = await db
    .select({ name: products.name })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(productVariants, purchasableVariant())
    .where(and(...PUBLISHED_PRODUCT))
    .groupBy(products.id)
    .orderBy(desc(products.soldCount), asc(products.id))
    .limit(POPULAR_TERM_COUNT);
  return rows.map((row) => row.name);
}
