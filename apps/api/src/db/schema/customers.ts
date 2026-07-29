import { ADMIN_ROLE, CUSTOMER_STATUS, SUBJECT_TYPE } from '@silkgrain/contracts';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { productVariants, products } from './catalog';
import { at, createdAt, email, fk, pk, updatedAt } from './columns';

export const customers = mysqlTable(
  'customers',
  {
    id: pk(),
    email: email().notNull(),
    /**
     * Argon2id, never bcrypt. Nullable because a guest checkout creates the customer row
     * first and the account is claimed afterwards from the confirmation screen.
     */
    passwordHash: varchar('password_hash', { length: 255 }),
    firstName: varchar('first_name', { length: 80 }).notNull(),
    lastName: varchar('last_name', { length: 80 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    emailVerifiedAt: at('email_verified_at'),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    status: mysqlEnum('status', CUSTOMER_STATUS).notNull().default('active'),
    lastLoginAt: at('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('customers_email_uq').on(table.email)],
);

/**
 * Staff accounts. A separate table rather than a role column on `customers`, so a bug in
 * customer registration can never mint an administrator, and the two login rate limits,
 * password policies and session lifetimes can diverge without a migration.
 */
export const adminUsers = mysqlTable(
  'admin_users',
  {
    id: pk(),
    email: email().notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    role: mysqlEnum('role', ADMIN_ROLE).notNull().default('support'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: at('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('admin_users_email_uq').on(table.email)],
);

/**
 * Refresh tokens, stored as a SHA-256 hash of the token itself.
 *
 * Hashed because a database dump must not be a set of working sessions. Not Argon2 here:
 * the token is 48 bytes of CSPRNG output, so there is no low-entropy password to slow an
 * attacker down over, and every request would otherwise pay the memory-hard cost.
 *
 * `familyId` groups the whole rotation chain. If a token that was already used is presented
 * again - the classic sign of a stolen cookie - the entire family is revoked at once, which
 * logs out both the thief and the victim rather than letting the theft continue silently.
 */
export const refreshTokens = mysqlTable(
  'refresh_tokens',
  {
    id: pk(),
    subjectType: mysqlEnum('subject_type', SUBJECT_TYPE).notNull(),
    subjectId: fk('subject_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    familyId: varchar('family_id', { length: 36 }).notNull(),
    expiresAt: at('expires_at').notNull(),
    /** Set when the token is rotated or revoked; a set value never becomes unset. */
    revokedAt: at('revoked_at'),
    revokedReason: varchar('revoked_reason', { length: 40 }),
    userAgent: varchar('user_agent', { length: 400 }),
    ip: varchar('ip', { length: 45 }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_uq').on(table.tokenHash),
    index('refresh_tokens_subject_idx').on(table.subjectType, table.subjectId),
    index('refresh_tokens_family_idx').on(table.familyId),
    index('refresh_tokens_expiry_idx').on(table.expiresAt),
  ],
);

export const wishlists = mysqlTable(
  'wishlists',
  {
    id: pk(),
    customerId: fk('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull().default('Wishlist'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('wishlists_customer_idx').on(table.customerId)],
);

export const wishlistItems = mysqlTable(
  'wishlist_items',
  {
    wishlistId: fk('wishlist_id')
      .notNull()
      .references(() => wishlists.id, { onDelete: 'cascade' }),
    productId: fk('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** The weight the customer was looking at. Null means "whichever is default". */
    variantId: fk('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.wishlistId, table.productId] })],
);

// --------------------------------------------------------------------------------------
// Relations
// --------------------------------------------------------------------------------------

export const customersRelations = relations(customers, ({ many }) => ({
  wishlists: many(wishlists),
}));

export const wishlistsRelations = relations(wishlists, ({ one, many }) => ({
  customer: one(customers, { fields: [wishlists.customerId], references: [customers.id] }),
  items: many(wishlistItems),
}));

export const wishlistItemsRelations = relations(wishlistItems, ({ one }) => ({
  wishlist: one(wishlists, { fields: [wishlistItems.wishlistId], references: [wishlists.id] }),
  product: one(products, { fields: [wishlistItems.productId], references: [products.id] }),
  variant: one(productVariants, {
    fields: [wishlistItems.variantId],
    references: [productVariants.id],
  }),
}));
