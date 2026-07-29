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
    action: varchar('action', { length: 60 }).notNull(),
    entityType: varchar('entity_type', { length: 60 }).notNull(),
    entityId: fk('entity_id'),
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
  ],
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  admin: one(adminUsers, { fields: [auditLog.adminUserId], references: [adminUsers.id] }),
}));
