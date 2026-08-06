import type {
  Badge,
  Certification,
  Origin,
  ProductListQuery,
  ProductSort,
} from '@silkgrain/contracts';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  like,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  categories,
  productBadges,
  productCertifications,
  productVariants,
  products,
} from '../../db/schema';

/**
 * Translating the shop sidebar into SQL.
 *
 * Two shapes recur here and both are deliberate:
 *
 * - **Existence, not joins.** "Has a variant under $20" is an `EXISTS` subquery rather than a
 *   condition on a joined row. Joining would multiply the product by its matching variants and
 *   quietly turn the price aggregate into the aggregate of the *filtered* variants - so a card
 *   filtered to "under $20" would advertise a range ending at $20 instead of its real one.
 * - **Every facet is OR inside, AND across.** Ticking Organic and Halal means either
 *   certification; ticking Organic and the Rice category means both. That is what every
 *   catalogue does, and the counts in the sidebar are computed to match.
 */

/** A variant a customer could actually buy: active, belonging to the product being tested. */
function variantsOf(product: typeof products) {
  return and(eq(productVariants.productId, product.id), eq(productVariants.isActive, true));
}

/**
 * Escapes a user string for `LIKE`.
 *
 * Without this a search for `50%` matches every product in the catalogue, and one for `_`
 * matches everything with at least one character. The backslash is MySQL's default escape.
 */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export interface ProductFilterInput {
  /** Already resolved from slugs, with children folded in. Empty array means "match nothing". */
  categoryIds?: number[];
  slug?: string[];
  origin?: Origin[];
  cert?: Certification[];
  badge?: Badge[];
  weight?: string[];
  priceMinCents?: number;
  priceMaxCents?: number;
  inStock?: boolean;
  q?: string;
}

/** Which filters to leave out. A facet is counted with its own filter removed - see below. */
export interface FilterOmission {
  category?: boolean;
  price?: boolean;
  weight?: boolean;
  origin?: boolean;
  cert?: boolean;
}

/**
 * The conditions every storefront query starts from.
 *
 * A draft or archived product is not merely hidden from the grid: it must not be reachable by
 * slug, by search or by adding its variant to a cart, so this predicate is the one place that
 * decides what "in the catalogue" means.
 *
 * Deactivating a category counts too. `listCategories` already hides an inactive one from the
 * menu, and without this its products would go on appearing in the grid, in search and on
 * their own detail pages - visible to anyone with the link and unreachable through the
 * navigation, which is the worst of both.
 */
// A list rather than one combined condition: `and()` is typed as possibly undefined because
// its argument list could be empty, and spreading at the call sites avoids having to assert
// that it is not. Every query that uses this has to join `categories`.
export const PUBLISHED_PRODUCT: SQL[] = [
  eq(products.status, 'active'),
  eq(categories.isActive, true),
];

export function buildProductConditions(
  db: Database,
  filters: ProductFilterInput,
  omit: FilterOmission = {},
): SQL[] {
  const conditions: SQL[] = [...PUBLISHED_PRODUCT];

  if (!omit.category && filters.categoryIds) {
    // An empty set means the caller asked for a slug that does not exist. `IN ()` is a syntax
    // error in MySQL, and silently dropping the filter would answer a question nobody asked.
    conditions.push(
      filters.categoryIds.length > 0
        ? inArray(products.categoryId, filters.categoryIds)
        : sql`1 = 0`,
    );
  }

  if (filters.slug && filters.slug.length > 0) {
    conditions.push(inArray(products.slug, filters.slug));
  }

  if (!omit.origin && filters.origin && filters.origin.length > 0) {
    conditions.push(inArray(products.origin, filters.origin));
  }

  if (!omit.cert && filters.cert && filters.cert.length > 0) {
    const certs = filters.cert;
    conditions.push(
      exists(
        db
          .select({ present: sql`1` })
          .from(productCertifications)
          .where(
            and(
              eq(productCertifications.productId, products.id),
              inArray(productCertifications.certification, certs),
            ),
          ),
      ),
    );
  }

  if (filters.badge && filters.badge.length > 0) {
    const badgeCondition = buildBadgeCondition(db, filters.badge);
    if (badgeCondition) conditions.push(badgeCondition);
  }

  if (!omit.weight && filters.weight && filters.weight.length > 0) {
    const labels = filters.weight;
    conditions.push(
      exists(
        db
          .select({ present: sql`1` })
          .from(productVariants)
          .where(and(variantsOf(products), inArray(productVariants.weightLabel, labels))),
      ),
    );
  }

  if (!omit.price && (filters.priceMinCents !== undefined || filters.priceMaxCents !== undefined)) {
    const bounds: SQL[] = [];
    if (filters.priceMinCents !== undefined) {
      bounds.push(gte(productVariants.priceCents, filters.priceMinCents));
    }
    if (filters.priceMaxCents !== undefined) {
      bounds.push(lte(productVariants.priceCents, filters.priceMaxCents));
    }
    conditions.push(
      exists(
        db
          .select({ present: sql`1` })
          .from(productVariants)
          .where(and(variantsOf(products), ...bounds)),
      ),
    );
  }

  if (filters.inStock === true) {
    conditions.push(
      exists(
        db
          .select({ present: sql`1` })
          .from(productVariants)
          .where(and(variantsOf(products), sql`${productVariants.stockQty} > 0`)),
      ),
    );
  }

  if (filters.q !== undefined && filters.q.length > 0) {
    const pattern = likePattern(filters.q);
    // `LIKE '%term%'` rather than a FULLTEXT index: the catalogue is a few dozen rows, and a
    // FULLTEXT index brings a minimum word length and a stopword list that would drop "rice"
    // from its own search results. Revisit when the catalogue passes a few thousand products.
    const match = or(
      like(products.name, pattern),
      like(products.blurb, pattern),
      like(products.subtitle, pattern),
      like(categories.name, pattern),
    );
    if (match) conditions.push(match);
  }

  return conditions;
}

/**
 * Badges are half stored and half derived (decision D-12), so filtering by one is not a single
 * lookup. `sale` asks the variants, `organic` asks the certifications, and the editorial three
 * ask `product_badges`; a customer ticking several gets the union.
 */
function buildBadgeCondition(db: Database, badges: Badge[]): SQL | undefined {
  const editorial = badges.filter(
    (badge): badge is Exclude<Badge, 'sale' | 'organic'> => badge !== 'sale' && badge !== 'organic',
  );
  const branches: SQL[] = [];

  if (editorial.length > 0) {
    branches.push(
      exists(
        db
          .select({ present: sql`1` })
          .from(productBadges)
          .where(
            and(eq(productBadges.productId, products.id), inArray(productBadges.badge, editorial)),
          ),
      ),
    );
  }

  if (badges.includes('sale')) {
    branches.push(
      exists(
        db
          .select({ present: sql`1` })
          .from(productVariants)
          .where(and(variantsOf(products), isNotNull(productVariants.compareAtPriceCents))),
      ),
    );
  }

  if (badges.includes('organic')) {
    branches.push(
      exists(
        db
          .select({ present: sql`1` })
          .from(productCertifications)
          .where(
            and(
              eq(productCertifications.productId, products.id),
              eq(productCertifications.certification, 'organic'),
            ),
          ),
      ),
    );
  }

  return branches.length > 0 ? or(...branches) : undefined;
}

/**
 * The average rating, guarded against a division by zero.
 *
 * The aggregate is stored as a sum and a count (decision D-13), so the average exists only in
 * expressions like this one - which is the point: there is no column that can drift out of
 * step with the reviews.
 */
const AVERAGE_RATING = sql`CASE WHEN ${products.reviewCount} = 0 THEN 0
  ELSE ${products.ratingTotal} / ${products.reviewCount} END`;

/**
 * The lowest active variant price - the "from $14.99" the card shows and the price sorts sort
 * on. The upper bound is not computed here: the card's range comes from the variant rows the
 * assembly step already has in hand, and an aggregate over a filtered join would describe the
 * matching variants rather than the product.
 */
export const PRICE_FROM = sql<number>`MIN(${productVariants.priceCents})`;

/**
 * Every sort ends with the product id.
 *
 * Without a total order, MySQL is free to return two pages that both contain the same product
 * and neither of which contains another - the classic paginated-list bug, and one that only
 * shows up once there are enough rows to matter.
 */
export function orderFor(sort: ProductSort): SQL[] {
  switch (sort) {
    case 'price_asc':
      return [asc(PRICE_FROM), asc(products.id)];
    case 'price_desc':
      return [desc(PRICE_FROM), asc(products.id)];
    case 'newest':
      // MySQL sorts NULL last under DESC, which is what an unpublished date deserves here.
      return [desc(products.publishedAt), desc(products.id)];
    case 'bestselling':
      return [desc(products.soldCount), asc(products.id)];
    case 'rating':
      // Review count breaks the tie so a single five-star review does not outrank a hundred.
      return [desc(AVERAGE_RATING), desc(products.reviewCount), asc(products.id)];
    case 'featured':
    default:
      return [desc(products.isFeatured), desc(products.soldCount), asc(products.id)];
  }
}

/** Narrows the validated query to just the filter fields, so callers cannot pass a stray one. */
export function filtersFrom(
  query: ProductListQuery,
  categoryIds: number[] | undefined,
): ProductFilterInput {
  return {
    ...(categoryIds === undefined ? {} : { categoryIds }),
    ...(query.slug === undefined ? {} : { slug: query.slug }),
    ...(query.origin === undefined ? {} : { origin: query.origin }),
    ...(query.cert === undefined ? {} : { cert: query.cert }),
    ...(query.badge === undefined ? {} : { badge: query.badge }),
    ...(query.weight === undefined ? {} : { weight: query.weight }),
    ...(query.priceMinCents === undefined ? {} : { priceMinCents: query.priceMinCents }),
    ...(query.priceMaxCents === undefined ? {} : { priceMaxCents: query.priceMaxCents }),
    ...(query.inStock === undefined ? {} : { inStock: query.inStock }),
    ...(query.q === undefined ? {} : { q: query.q }),
  };
}

export { likePattern };
