import { z } from 'zod';

import { PRODUCT_SORT } from '../constants';
import { Badge, Certification, Origin, ProductStatus, StockState, WeightUnit } from '../enums';
import { PageMeta, PageNumber } from '../pagination';
import { Cents, Currency, Id, IsoDate, Slug } from '../primitives';

/**
 * Query-string arrays.
 *
 * Fastify's default parser turns `?origin=UZ&origin=KZ` into an array and a single
 * `?origin=UZ` into a string, so every repeatable filter has to accept both. Comma-separated
 * values are accepted too, because that is what a shareable filter URL ends up looking like.
 */
/**
 * How many values one facet may carry.
 *
 * Comfortably above any sidebar - the largest facet in the design has six boxes - and low
 * enough that a hand-written query string cannot turn a single request into four `IN (...)`
 * lists with a thousand placeholders each.
 */
const FACET_VALUE_LIMIT = 40;

function repeatable<Schema extends z.ZodTypeAny>(schema: Schema) {
  return z.preprocess(
    (value: unknown): unknown => {
      if (value === undefined) return undefined;
      // `Array.isArray` widens `unknown` to `any[]`, which would leak an implicit `any` into
      // every filter built from this helper. The cast keeps it at `unknown[]`.
      const list: unknown[] = Array.isArray(value) ? (value as unknown[]) : [value];
      return list.flatMap((entry) =>
        typeof entry === 'string' ? entry.split(',').filter(Boolean) : [entry],
      );
    },
    z
      .array(schema)
      .max(FACET_VALUE_LIMIT, `A filter takes at most ${String(FACET_VALUE_LIMIT)} values`),
  );
}

/**
 * A boolean from a query string.
 *
 * Not `z.coerce.boolean()`: that is `Boolean(value)`, so `?inStock=false` arrives as the string
 * `"false"`, which is truthy, and the filter turns itself on. Only the two words mean anything
 * here; everything else is a malformed request and is rejected as one.
 *
 * Exported because every query-string boolean in the platform has to use it - the admin's
 * `lowStock` filter is the second - and a second hand-rolled coercion is a second chance to make
 * the same mistake.
 */
export const QueryBoolean = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

// --------------------------------------------------------------------------------------
// Categories
// --------------------------------------------------------------------------------------

export const CategorySummary = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  description: z.string().nullable(),
  /** Phosphor icon name without the `ph-` prefix. */
  icon: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  /** Active products in this category, counted from the database - never a hard-coded number. */
  productCount: z.number().int().nonnegative(),
});
export type CategorySummary = z.infer<typeof CategorySummary>;

/**
 * One level of nesting, not arbitrary recursion.
 *
 * The schema supports subcategories because `categories.parent_id` does, but the mega-menu is
 * a flat 3x2 grid and nothing in the design goes deeper. A recursive Zod type would also cost
 * the OpenAPI document its ability to describe this shape.
 */
export const CategoryNode = CategorySummary.extend({
  children: z.array(CategorySummary),
});
export type CategoryNode = z.infer<typeof CategoryNode>;

export const CategoryListResponse = z.object({ items: z.array(CategoryNode) });
export type CategoryListResponse = z.infer<typeof CategoryListResponse>;

// --------------------------------------------------------------------------------------
// Products
// --------------------------------------------------------------------------------------

export const ProductImage = z.object({
  url: z.string().url(),
  alt: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  isPrimary: z.boolean(),
});
export type ProductImage = z.infer<typeof ProductImage>;

export const ProductVariantView = z.object({
  id: Id,
  sku: z.string(),
  /** What the designer wrote and what the customer picks: "5 lb", "8 oz", "1 kit". */
  weightLabel: z.string(),
  weightUnit: WeightUnit,
  weightGrams: z.number().int().positive().nullable(),
  priceCents: Cents,
  /** Set means the variant is marked down; the Sale badge is derived from exactly this. */
  compareAtPriceCents: Cents.nullable(),
  currency: Currency,
  stockState: StockState,
  /**
   * How many the customer may add, capped at the per-line maximum.
   *
   * Deliberately not the real stock level: an endpoint that reports "1,483 in stock" hands a
   * competitor the inventory position for free. Capped, it still tells the cart everything it
   * needs to clamp a quantity.
   */
  availableQty: z.number().int().nonnegative(),
  isDefault: z.boolean(),
});
export type ProductVariantView = z.infer<typeof ProductVariantView>;

export const RatingSummary = z.object({
  /** Rounded to one decimal for display. The authoritative pair is the sum and the count. */
  average: z.number().min(0).max(5),
  count: z.number().int().nonnegative(),
});
export type RatingSummary = z.infer<typeof RatingSummary>;

/**
 * A card in a grid. Exactly the fields `ProductCardPremium` draws, and no more.
 *
 * `ProductDetail` extends this rather than the other way round, so a page of sixteen cards
 * never carries nutrition panels and provenance essays, and the card cannot accidentally
 * start returning a field that has no place in a grid.
 */
export const ProductCard = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  blurb: z.string(),
  category: z.object({ slug: Slug, name: z.string() }),
  image: z.object({ url: z.string().url(), alt: z.string() }).nullable(),
  /** CSS gradient behind the photograph while it loads. From the mockup. */
  tone: z.string().nullable(),
  icon: z.string().nullable(),
  /** Editorial badges plus `sale` and `organic`, both derived rather than stored. */
  badges: z.array(Badge),
  rating: RatingSummary.nullable(),
  stockState: StockState,
  origin: Origin,
  /** "2 lb · 5 lb · 10 lb" under the name. */
  weightLabels: z.array(z.string()),
  priceFromCents: Cents,
  priceToCents: Cents,
  /** The default variant, so "Add to Cart" works straight from the grid. */
  defaultVariantId: Id,
  currency: Currency,
  isFeatured: z.boolean(),
});
export type ProductCard = z.infer<typeof ProductCard>;

export const NutritionFacts = z.object({
  servingSize: z.string(),
  servingsPerContainer: z.number().int().positive().nullable(),
  calories: z.number().int().nonnegative(),
  /** Every quantity in milligrams, as stored. The label divides; the database never rounds. */
  fatMg: z.number().int().nonnegative(),
  satFatMg: z.number().int().nonnegative(),
  carbsMg: z.number().int().nonnegative(),
  sugarsMg: z.number().int().nonnegative(),
  fiberMg: z.number().int().nonnegative(),
  proteinMg: z.number().int().nonnegative(),
  sodiumMg: z.number().int().nonnegative(),
  ingredientsText: z.string(),
  allergensText: z.string().nullable(),
});
export type NutritionFacts = z.infer<typeof NutritionFacts>;

export const ProductReview = z.object({
  id: Id,
  authorName: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  isVerifiedPurchase: z.boolean(),
  publishedAt: IsoDate,
});
export type ProductReview = z.infer<typeof ProductReview>;

/**
 * A published review, lifted out of its product for the home page's testimonials.
 *
 * The mockup's three cards carry a quote, a name, and a line reading "Brooklyn, NY · Devzira
 * Rice". The product is real and comes back here; the city does not exist on a review and is
 * not invented, so the card says what the shop actually knows about the person who wrote it.
 */
export const Testimonial = ProductReview.extend({
  product: z.object({ slug: Slug, name: z.string() }),
});
export type Testimonial = z.infer<typeof Testimonial>;

export const TestimonialListQuery = z
  .object({ limit: z.coerce.number().int().min(1).max(12).default(3) })
  .strict();
export type TestimonialListQuery = z.infer<typeof TestimonialListQuery>;

export const TestimonialListResponse = z.object({ items: z.array(Testimonial) });
export type TestimonialListResponse = z.infer<typeof TestimonialListResponse>;

export const ReviewBreakdown = z.object({
  average: z.number().min(0).max(5),
  count: z.number().int().nonnegative(),
  /** Reviews per star, for the histogram. Keyed by the star value as a string. */
  histogram: z.object({
    '1': z.number().int().nonnegative(),
    '2': z.number().int().nonnegative(),
    '3': z.number().int().nonnegative(),
    '4': z.number().int().nonnegative(),
    '5': z.number().int().nonnegative(),
  }),
  items: z.array(ProductReview),
});
export type ReviewBreakdown = z.infer<typeof ReviewBreakdown>;

export const ProductDetail = ProductCard.extend({
  subtitle: z.string().nullable(),
  /** Markdown. */
  description: z.string(),
  story: z.string().nullable(),
  originRegion: z.string().nullable(),
  status: ProductStatus,
  images: z.array(ProductImage),
  variants: z.array(ProductVariantView).min(1),
  certifications: z.array(Certification),
  nutrition: NutritionFacts.nullable(),
  reviews: ReviewBreakdown,
  seo: z.object({
    metaTitle: z.string().nullable(),
    metaDescription: z.string().nullable(),
  }),
  publishedAt: IsoDate.nullable(),
});
export type ProductDetail = z.infer<typeof ProductDetail>;

export const ProductDetailResponse = z.object({
  product: ProductDetail,
  /** "You May Also Like": same category first, topped up from the rest of the catalogue. */
  related: z.array(ProductCard),
});
export type ProductDetailResponse = z.infer<typeof ProductDetailResponse>;

export const ProductSort = z.enum(PRODUCT_SORT);
export type ProductSort = z.infer<typeof ProductSort>;

export const ProductListQuery = z
  .object({
    category: repeatable(Slug).optional(),
    /**
     * Specific products, by slug.
     *
     * The wishlist holds slugs and nothing else, and this is how it turns them into cards -
     * one request for the whole list, through the same projection every grid uses. It is a
     * filter rather than a separate endpoint precisely so a wishlist card carries the same
     * derived badges and stock state as a card in the catalogue.
     */
    slug: repeatable(Slug).optional(),
    origin: repeatable(Origin).optional(),
    cert: repeatable(Certification).optional(),
    badge: repeatable(Badge).optional(),
    /** Weight labels exactly as they appear on the variant: "1 lb", "5 lb", "8 oz". */
    weight: repeatable(z.string().min(1).max(40)).optional(),
    priceMinCents: z.coerce.number().int().nonnegative().optional(),
    priceMaxCents: z.coerce.number().int().nonnegative().optional(),
    /** Only products with something buyable. */
    inStock: QueryBoolean.optional(),
    q: z.string().trim().min(1).max(120).optional(),
    sort: ProductSort.default('featured'),
    page: PageNumber.default(1),
    perPage: z.coerce.number().int().min(1).max(48).default(16),
  })
  .strict()
  .refine(
    (value) =>
      value.priceMinCents === undefined ||
      value.priceMaxCents === undefined ||
      value.priceMinCents <= value.priceMaxCents,
    { message: 'priceMinCents must not exceed priceMaxCents', path: ['priceMinCents'] },
  );
export type ProductListQuery = z.infer<typeof ProductListQuery>;

const FacetCount = z.number().int().nonnegative();

/**
 * What the shop sidebar needs beyond the rows themselves.
 *
 * There is one entry here for each card the sidebar draws: Categories, Price Range, Weight,
 * Origin and Certifications. None of them may be hard-coded on the client - the mockup lists
 * weights as 1/2/5/10/25/50 lb, which is not this catalogue's set, and would go stale the
 * first time a variant is added.
 *
 * Every facet is computed with its own filter removed. Ticking "Rice" must not collapse the
 * other categories to zero and strand the customer, and the price slider's own handles must
 * not keep shrinking the track they sit on. Values that currently match nothing are kept at
 * zero rather than dropped, so the sidebar does not reflow as boxes are ticked.
 */
export const ProductFacets = z.object({
  categories: z.array(z.object({ slug: Slug, name: z.string(), count: FacetCount })),
  /** Ordered lightest first. The label is the designer's string and what the checkbox shows. */
  weights: z.array(z.object({ label: z.string(), count: FacetCount })),
  origins: z.array(z.object({ value: Origin, count: FacetCount })),
  certifications: z.array(z.object({ value: Certification, count: FacetCount })),
  price: z.object({ minCents: Cents, maxCents: Cents }),
});
export type ProductFacets = z.infer<typeof ProductFacets>;

export const ProductListResponse = z.object({
  items: z.array(ProductCard),
  meta: PageMeta,
  facets: ProductFacets,
});
export type ProductListResponse = z.infer<typeof ProductListResponse>;

// --------------------------------------------------------------------------------------
// Search
// --------------------------------------------------------------------------------------

/**
 * `q` is optional because the overlay opens before anything is typed.
 *
 * In that state the panel shows only the popular-term chips, and those come back in the same
 * response - so the overlay is one request, not one request plus a special case for the empty
 * field. An empty or absent term returns no items and the chips.
 */
export const SearchSuggestQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(12).default(6),
  })
  .strict();
export type SearchSuggestQuery = z.infer<typeof SearchSuggestQuery>;

export const SearchSuggestion = z.object({
  slug: Slug,
  name: z.string(),
  categoryName: z.string(),
  image: z.string().url().nullable(),
  priceFromCents: Cents,
  currency: Currency,
});
export type SearchSuggestion = z.infer<typeof SearchSuggestion>;

export const SearchSuggestResponse = z.object({
  items: z.array(SearchSuggestion),
  /** Rendered as chips while the field is empty. */
  popular: z.array(z.string()),
});
export type SearchSuggestResponse = z.infer<typeof SearchSuggestResponse>;
