import {
  CONTACT_STATUS,
  FAQ_CATEGORY,
  NEWSLETTER_STATUS,
  RECIPE_DIFFICULTY,
} from '@silkgrain/contracts';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { products } from './catalog';
import { at, createdAt, email, fk, pk, position, slug, updatedAt } from './columns';

export const recipes = mysqlTable(
  'recipes',
  {
    id: pk(),
    slug: slug().notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    excerpt: varchar('excerpt', { length: 400 }).notNull(),
    heroImageUrl: varchar('hero_image_url', { length: 500 }),
    heroImageAlt: varchar('hero_image_alt', { length: 300 }),
    /** Markdown. Ingredients and steps are headings inside it, not separate tables. */
    body: text('body').notNull(),
    prepMinutes: int('prep_minutes').notNull(),
    cookMinutes: int('cook_minutes').notNull(),
    servings: int('servings').notNull(),
    difficulty: mysqlEnum('difficulty', RECIPE_DIFFICULTY).notNull().default('medium'),
    isPublished: boolean('is_published').notNull().default(false),
    publishedAt: at('published_at'),
    metaTitle: varchar('meta_title', { length: 200 }),
    metaDescription: varchar('meta_description', { length: 320 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('recipes_slug_uq').on(table.slug),
    check('recipes_times_nonneg', sql`${table.prepMinutes} >= 0 AND ${table.cookMinutes} >= 0`),
    check('recipes_servings_positive', sql`${table.servings} > 0`),
  ],
);

/**
 * Products used by a recipe. A join table rather than the brief's JSON array of ids: the
 * storefront renders "Shop the ingredients" from it, and a JSON column cannot stop that list
 * from pointing at a product that no longer exists.
 */
export const recipeProducts = mysqlTable(
  'recipe_products',
  {
    recipeId: fk('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    productId: fk('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    position: position(),
  },
  (table) => [primaryKey({ columns: [table.recipeId, table.productId] })],
);

export const faqs = mysqlTable(
  'faqs',
  {
    id: pk(),
    category: mysqlEnum('category', FAQ_CATEGORY).notNull(),
    question: varchar('question', { length: 300 }).notNull(),
    answer: text('answer').notNull(),
    position: position(),
    isPublished: boolean('is_published').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('faqs_category_idx').on(table.category, table.position)],
);

export const newsletterSubscribers = mysqlTable(
  'newsletter_subscribers',
  {
    id: pk(),
    email: email().notNull(),
    status: mysqlEnum('status', NEWSLETTER_STATUS).notNull().default('subscribed'),
    /** Where the address came from: `footer`, `checkout`, `subscribe_save`. */
    source: varchar('source', { length: 40 }),
    /** Opaque token in the unsubscribe link, so no email address travels in a URL. */
    unsubscribeToken: varchar('unsubscribe_token', { length: 64 }).notNull(),
    confirmedAt: at('confirmed_at'),
    unsubscribedAt: at('unsubscribed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('newsletter_subscribers_email_uq').on(table.email),
    uniqueIndex('newsletter_subscribers_token_uq').on(table.unsubscribeToken),
  ],
);

export const contactMessages = mysqlTable(
  'contact_messages',
  {
    id: pk(),
    name: varchar('name', { length: 120 }).notNull(),
    email: email().notNull(),
    subject: varchar('subject', { length: 200 }).notNull(),
    body: text('body').notNull(),
    orderNumber: varchar('order_number', { length: 20 }),
    status: mysqlEnum('status', CONTACT_STATUS).notNull().default('new'),
    submittedIp: varchar('submitted_ip', { length: 45 }),
    answeredAt: at('answered_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('contact_messages_status_idx').on(table.status, table.createdAt)],
);

// --------------------------------------------------------------------------------------
// Relations
// --------------------------------------------------------------------------------------

export const recipesRelations = relations(recipes, ({ many }) => ({
  products: many(recipeProducts),
}));

export const recipeProductsRelations = relations(recipeProducts, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeProducts.recipeId], references: [recipes.id] }),
  product: one(products, { fields: [recipeProducts.productId], references: [products.id] }),
}));
