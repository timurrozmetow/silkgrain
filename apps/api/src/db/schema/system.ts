import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { createdAt, fk, pk, updatedAt } from './columns';
import { adminUsers } from './customers';

/**
 * Key/value settings the owner edits in the admin panel: store address, contact email,
 * default tax rate, free-shipping threshold, announcement-bar copy.
 *
 * Values are JSON so a setting can be a number, a string or a small object without a
 * migration, and `group` is what the settings screen renders its sections from.
 */
export const settings = mysqlTable(
  'settings',
  {
    id: pk(),
    key: varchar('setting_key', { length: 100 }).notNull(),
    value: json('value'),
    group: varchar('group_name', { length: 60 }).notNull().default('general'),
    label: varchar('label', { length: 200 }).notNull(),
    description: varchar('description', { length: 400 }),
    /** False keeps a setting out of any storefront response - ops addresses, API keys. */
    isPublic: boolean('is_public').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('settings_key_uq').on(table.key)],
);

/**
 * Who changed what, in the admin panel.
 *
 * `before` and `after` hold only the fields that actually changed, so the log stays readable
 * and a password hash or a card detail cannot end up archived here by accident.
 */
export const auditLog = mysqlTable(
  'audit_log',
  {
    id: pk(),
    adminUserId: fk('admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    /** Copied so the entry still names the actor after the account is deleted. */
    actorName: varchar('actor_name', { length: 120 }).notNull(),
    /**
     * The authority the action was taken with, copied for the same reason as the name.
     *
     * An entry that says who but not with what standing answers half the question a month later,
     * and the account's current role is not the role it acted under - that is the whole point of
     * the Team screen being able to change one.
     */
    actorRole: varchar('actor_role', { length: 20 }).notNull(),
    action: varchar('action', { length: 60 }).notNull(),
    entityType: varchar('entity_type', { length: 60 }).notNull(),
    entityId: fk('entity_id'),
    /**
     * What the row was called at the time - an order number, a product name, a promo code.
     *
     * Without it the log reads "product 41 updated" and the only way to learn which product is a
     * join that fails exactly when it matters, because the row was deleted. A label is what makes
     * an entry legible on its own.
     */
    entityLabel: varchar('entity_label', { length: 200 }),
    before: json('before'),
    after: json('after'),
    ip: varchar('ip', { length: 45 }),
    userAgent: varchar('user_agent', { length: 400 }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
    index('audit_log_actor_idx').on(table.adminUserId, table.createdAt),
    /** The default read: newest first, keyset on the id. */
    index('audit_log_created_idx').on(table.createdAt, table.id),
    /** "What happened to the prices last week" - one action across a window. */
    index('audit_log_action_idx').on(table.action, table.createdAt),
  ],
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  admin: one(adminUsers, { fields: [auditLog.adminUserId], references: [adminUsers.id] }),
}));
