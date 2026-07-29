import { BUSINESS_TYPE, VOLUME_BAND, WHOLESALE_STATUS } from '@silkgrain/contracts';
import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { productVariants } from './catalog';
import { at, createdAt, email, fk, money, pk, updatedAt } from './columns';
import { adminUsers } from './customers';

/**
 * Wholesale enquiries.
 *
 * The address columns are nullable on purpose (decision D-5): the mockup's form asks for a
 * single contact name and no business address, and the owner confirmed that shape for now.
 * Keeping the columns means extending the form later is a form change, not a migration.
 */
export const wholesaleRequests = mysqlTable(
  'wholesale_requests',
  {
    id: pk(),
    businessName: varchar('business_name', { length: 200 }).notNull(),
    businessType: mysqlEnum('business_type', BUSINESS_TYPE).notNull(),
    contactFirstName: varchar('contact_first_name', { length: 80 }).notNull(),
    contactLastName: varchar('contact_last_name', { length: 80 }),
    email: email().notNull(),
    phone: varchar('phone', { length: 32 }),

    addressLine1: varchar('address_line1', { length: 200 }),
    addressLine2: varchar('address_line2', { length: 200 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 2 }),
    zip: varchar('zip', { length: 10 }),

    /** Category slugs the business is interested in. */
    categoriesOfInterest: json('categories_of_interest').$type<string[]>(),
    monthlyVolumeBand: mysqlEnum('monthly_volume_band', VOLUME_BAND).notNull(),
    notes: text('notes'),

    status: mysqlEnum('status', WHOLESALE_STATUS).notNull().default('new'),
    assignedToId: fk('assigned_to_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    /** Kept for abuse investigation; never returned by any endpoint. */
    submittedIp: varchar('submitted_ip', { length: 45 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('wholesale_requests_status_idx').on(table.status, table.createdAt),
    index('wholesale_requests_email_idx').on(table.email),
  ],
);

export const wholesaleRequestNotes = mysqlTable(
  'wholesale_request_notes',
  {
    id: pk(),
    requestId: fk('request_id')
      .notNull()
      .references(() => wholesaleRequests.id, { onDelete: 'cascade' }),
    adminUserId: fk('admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    /** Copied so the note still says who wrote it after the account is removed. */
    authorName: varchar('author_name', { length: 120 }).notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('wholesale_request_notes_request_idx').on(table.requestId, table.createdAt)],
);

/**
 * Quantity breaks on a variant. Phase 2 creates the table and the seed leaves it empty:
 * wholesale pricing is quoted by hand until the owner defines the tiers, and an invented
 * price list would be worse than none.
 */
export const wholesalePriceTiers = mysqlTable(
  'wholesale_price_tiers',
  {
    id: pk(),
    variantId: fk('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    minQty: int('min_qty').notNull(),
    priceCents: money('price_cents').notNull(),
    validFrom: at('valid_from'),
    validTo: at('valid_to'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('wholesale_price_tiers_variant_qty_uq').on(table.variantId, table.minQty),
    check('wholesale_price_tiers_min_qty_positive', sql`${table.minQty} > 0`),
    check('wholesale_price_tiers_price_nonneg', sql`${table.priceCents} >= 0`),
  ],
);

// --------------------------------------------------------------------------------------
// Relations
// --------------------------------------------------------------------------------------

export const wholesaleRequestsRelations = relations(wholesaleRequests, ({ one, many }) => ({
  assignedTo: one(adminUsers, {
    fields: [wholesaleRequests.assignedToId],
    references: [adminUsers.id],
  }),
  notes: many(wholesaleRequestNotes),
}));

export const wholesaleRequestNotesRelations = relations(wholesaleRequestNotes, ({ one }) => ({
  request: one(wholesaleRequests, {
    fields: [wholesaleRequestNotes.requestId],
    references: [wholesaleRequests.id],
  }),
  author: one(adminUsers, {
    fields: [wholesaleRequestNotes.adminUserId],
    references: [adminUsers.id],
  }),
}));

export const wholesalePriceTiersRelations = relations(wholesalePriceTiers, ({ one }) => ({
  variant: one(productVariants, {
    fields: [wholesalePriceTiers.variantId],
    references: [productVariants.id],
  }),
}));
