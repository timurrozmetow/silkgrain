import { sql } from 'drizzle-orm';
import { bigint, datetime, int, varchar } from 'drizzle-orm/mysql-core';

/**
 * Column builders shared by every table, so the conventions below are stated once.
 *
 * - Surrogate keys are `BIGINT UNSIGNED AUTO_INCREMENT`. `INT` runs out at 2.1 billion, and
 *   the tables most likely to get there (`inventory_movements`, `audit_log`) are exactly the
 *   ones nobody wants to migrate under load.
 * - Money is `BIGINT` holding integer cents, always. Never `DECIMAL`, never `FLOAT`.
 * - Timestamps are `DATETIME(3)`, not `TIMESTAMP`: `TIMESTAMP` tops out in 2038, and a
 *   `promo_codes.ends_at` or a subscription date can legitimately be set past that.
 */

export const pk = () =>
  bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey();

/** Foreign-key column. Matches `pk()` exactly; a width mismatch silently kills index use. */
export const fk = (name: string) => bigint(name, { mode: 'number', unsigned: true });

/** An amount in integer cents. */
export const money = (name: string) => bigint(name, { mode: 'number' });

export const createdAt = () =>
  datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`);

/**
 * Maintained by Drizzle on every update rather than by MySQL's `ON UPDATE CURRENT_TIMESTAMP`.
 * All writes go through the ORM by project rule, and keeping it in application code means
 * `drizzle-kit` never has to diff a clause it models imperfectly.
 */
export const updatedAt = () =>
  datetime('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date());

export const at = (name: string) => datetime(name, { mode: 'date', fsp: 3 });

/** Slugs are indexed and compared exactly; 160 characters is the longest URL segment we allow. */
export const slug = () => varchar('slug', { length: 160 });

/** RFC 5321 caps an address at 254 characters. */
export const email = (name = 'email') => varchar(name, { length: 254 });

/** Sort key inside a parent. Sparse on purpose so a reorder is one UPDATE, not a renumber. */
export const position = () => int('position').notNull().default(0);
