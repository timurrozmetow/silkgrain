import {
  CERTIFICATION,
  INVENTORY_REASON,
  ORIGIN,
  PRODUCT_BADGE,
  PRODUCT_STATUS,
  REVIEW_STATUS,
  WEIGHT_UNIT,
} from '@silkgrain/contracts';
import { relations, sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  boolean,
  check,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { at, createdAt, fk, money, pk, position, slug, updatedAt } from './columns';
import { customers } from './customers';

export const categories = mysqlTable(
  'categories',
  {
    id: pk(),
    slug: slug().notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    /** Phosphor icon name without the `ph-` prefix, e.g. `bowl-food`. */
    icon: varchar('icon', { length: 60 }),
    imageUrl: varchar('image_url', { length: 500 }),
    parentId: fk('parent_id').references((): AnyMySqlColumn => categories.id, {
      onDelete: 'set null',
    }),
    position: position(),
    isActive: boolean('is_active').notNull().default(true),
    metaTitle: varchar('meta_title', { length: 200 }),
    metaDescription: varchar('meta_description', { length: 320 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('categories_slug_uq').on(table.slug),
    index('categories_parent_idx').on(table.parentId),
  ],
);

export const products = mysqlTable(
  'products',
  {
    id: pk(),
    slug: slug().notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    subtitle: varchar('subtitle', { length: 200 }),
    /** One line under the product name in the card. */
    blurb: varchar('blurb', { length: 300 }).notNull(),
    description: text('description').notNull(),
    /** Long-form provenance copy shown on the Origin tab. Markdown. */
    story: text('story'),
    categoryId: fk('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    origin: mysqlEnum('origin', ORIGIN).notNull(),
    /** Free text next to the country code: "Fergana Valley, Uzbekistan". */
    originRegion: varchar('origin_region', { length: 160 }),
    status: mysqlEnum('status', PRODUCT_STATUS).notNull().default('draft'),
    isFeatured: boolean('is_featured').notNull().default(false),
    /** CSS gradient the card falls back to before the photograph loads. From the mockup. */
    tone: varchar('tone', { length: 200 }),
    icon: varchar('icon', { length: 60 }),

    /**
     * Rating aggregate, kept as a sum and a count rather than an average.
     *
     * An average column cannot be updated correctly without re-reading every review, and a
     * float average of integers is exactly the kind of drift this codebase avoids elsewhere.
     * The displayed value is `ratingTotal / reviewCount`, computed at read time.
     */
    ratingTotal: int('rating_total').notNull().default(0),
    reviewCount: int('review_count').notNull().default(0),
    /** Units sold, maintained by the paid-order transaction. Drives the bestselling sort. */
    soldCount: int('sold_count').notNull().default(0),

    metaTitle: varchar('meta_title', { length: 200 }),
    metaDescription: varchar('meta_description', { length: 320 }),
    publishedAt: at('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('products_slug_uq').on(table.slug),
    index('products_category_idx').on(table.categoryId),
    index('products_status_idx').on(table.status, table.isFeatured),
    index('products_origin_idx').on(table.origin),
    check('products_rating_total_nonneg', sql`${table.ratingTotal} >= 0`),
    check('products_review_count_nonneg', sql`${table.reviewCount} >= 0`),
  ],
);

export const productVariants = mysqlTable(
  'product_variants',
  {
    id: pk(),
    productId: fk('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: varchar('sku', { length: 64 }).notNull(),

    /**
     * The authored quantity times 1000, as an integer: `2 lb` is 2000, `1 g` is 1000.
     *
     * Scaled integers rather than DECIMAL for the same reason money is: there is one way to
     * store a quantity and it is exact. Display never uses this - `weightLabel` is what the
     * designer wrote and what the customer sees.
     */
    weightValueMilli: int('weight_value_milli').notNull(),
    weightUnit: mysqlEnum('weight_unit', WEIGHT_UNIT).notNull(),
    weightLabel: varchar('weight_label', { length: 40 }).notNull(),
    /** Normalised for range filters and shipping. Null for `kit`, which has no weight. */
    weightGrams: int('weight_grams'),

    priceCents: money('price_cents').notNull(),
    /** Set means the variant is on sale; the storefront derives the Sale badge from it. */
    compareAtPriceCents: money('compare_at_price_cents'),
    /** Landed cost, for the admin margin column. Never leaves the admin API. */
    costCents: money('cost_cents'),

    stockQty: int('stock_qty').notNull().default(0),
    lowStockThreshold: int('low_stock_threshold').notNull().default(10),

    position: position(),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('product_variants_sku_uq').on(table.sku),
    index('product_variants_product_idx').on(table.productId),
    index('product_variants_price_idx').on(table.priceCents),
    // Enforced by the database, not only by the checkout transaction: an oversell has to be
    // impossible even if a future code path forgets to check.
    check('product_variants_stock_nonneg', sql`${table.stockQty} >= 0`),
    check('product_variants_price_nonneg', sql`${table.priceCents} >= 0`),
    check(
      'product_variants_compare_at_higher',
      sql`${table.compareAtPriceCents} IS NULL OR ${table.compareAtPriceCents} > ${table.priceCents}`,
    ),
  ],
);

export const productImages = mysqlTable(
  'product_images',
  {
    id: pk(),
    productId: fk('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    url: varchar('url', { length: 500 }).notNull(),
    alt: varchar('alt', { length: 300 }).notNull(),
    width: int('width'),
    height: int('height'),
    position: position(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index('product_images_product_idx').on(table.productId, table.position)],
);

/**
 * One row per product. Every quantity is an integer in milligrams so the FDA panel can be
 * rendered without a single floating-point value; `1.5 g` of fat is stored as 1500.
 */
export const productNutrition = mysqlTable('product_nutrition', {
  productId: fk('product_id')
    .primaryKey()
    .references(() => products.id, { onDelete: 'cascade' }),
  servingSize: varchar('serving_size', { length: 60 }).notNull(),
  servingsPerContainer: int('servings_per_container'),
  calories: int('calories').notNull(),
  fatMg: int('fat_mg').notNull(),
  satFatMg: int('sat_fat_mg').notNull(),
  carbsMg: int('carbs_mg').notNull(),
  sugarsMg: int('sugars_mg').notNull(),
  fiberMg: int('fiber_mg').notNull(),
  proteinMg: int('protein_mg').notNull(),
  sodiumMg: int('sodium_mg').notNull(),
  ingredientsText: text('ingredients_text').notNull(),
  allergensText: varchar('allergens_text', { length: 400 }),
  updatedAt: updatedAt(),
});

export const productCertifications = mysqlTable(
  'product_certifications',
  {
    productId: fk('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    certification: mysqlEnum('certification', CERTIFICATION).notNull(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.certification] })],
);

/**
 * Editorial badges only. `sale` and `organic` are never stored here - they are derived from
 * `compare_at_price_cents` and from the organic certification respectively, so the same fact
 * can never be recorded twice and disagree with itself.
 */
export const productBadges = mysqlTable(
  'product_badges',
  {
    productId: fk('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    badge: mysqlEnum('badge', PRODUCT_BADGE).notNull(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.badge] })],
);

export const reviews = mysqlTable(
  'reviews',
  {
    id: pk(),
    productId: fk('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Null for a review left before the customer registered, or by a guest buyer. */
    customerId: fk('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    authorName: varchar('author_name', { length: 120 }).notNull(),
    rating: tinyint('rating').notNull(),
    title: varchar('title', { length: 160 }),
    body: text('body').notNull(),
    status: mysqlEnum('status', REVIEW_STATUS).notNull().default('pending'),
    isVerifiedPurchase: boolean('is_verified_purchase').notNull().default(false),
    publishedAt: at('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('reviews_product_idx').on(table.productId, table.status),
    check('reviews_rating_range', sql`${table.rating} BETWEEN 1 AND 5`),
  ],
);

/**
 * Append-only stock ledger. `product_variants.stock_qty` is the running balance; this is why
 * it holds the value it does, and it is the only way to answer "where did that unit go".
 */
export const inventoryMovements = mysqlTable(
  'inventory_movements',
  {
    id: pk(),
    variantId: fk('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    /** Negative for a sale, positive for a restock or a return. */
    delta: int('delta').notNull(),
    reason: mysqlEnum('reason', INVENTORY_REASON).notNull(),
    /** Order id, return id or admin action id, depending on `reason`. */
    referenceId: fk('reference_id'),
    note: varchar('note', { length: 300 }),
    createdAt: createdAt(),
  },
  (table) => [index('inventory_movements_variant_idx').on(table.variantId, table.createdAt)],
);

// --------------------------------------------------------------------------------------
// Relations
// --------------------------------------------------------------------------------------

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_parent',
  }),
  children: many(categories, { relationName: 'category_parent' }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  variants: many(productVariants),
  images: many(productImages),
  nutrition: one(productNutrition, {
    fields: [products.id],
    references: [productNutrition.productId],
  }),
  certifications: many(productCertifications),
  badges: many(productBadges),
  reviews: many(reviews),
}));

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  movements: many(inventoryMovements),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}));

export const productCertificationsRelations = relations(productCertifications, ({ one }) => ({
  product: one(products, { fields: [productCertifications.productId], references: [products.id] }),
}));

export const productBadgesRelations = relations(productBadges, ({ one }) => ({
  product: one(products, { fields: [productBadges.productId], references: [products.id] }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, { fields: [reviews.productId], references: [products.id] }),
  customer: one(customers, { fields: [reviews.customerId], references: [customers.id] }),
}));

export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  variant: one(productVariants, {
    fields: [inventoryMovements.variantId],
    references: [productVariants.id],
  }),
}));
