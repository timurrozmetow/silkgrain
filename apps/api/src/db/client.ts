import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import * as schema from './schema';

export type Database = MySql2Database<typeof schema>;

/**
 * The handle a `db.transaction(...)` callback receives.
 *
 * Derived from `Database` rather than spelled out, so it cannot drift from the real type when
 * Drizzle changes. Anything that must work both inside and outside a transaction - which is
 * most of the write helpers - takes `DbExecutor`.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | Transaction;

export interface DatabaseHandle {
  db: Database;
  pool: mysql.Pool;
  close: () => Promise<void>;
}

/**
 * Opens the connection pool.
 *
 * `timezone: 'Z'` and `dateStrings: false` together mean a `DATETIME(3)` round-trips as a UTC
 * `Date` regardless of what the server or the machine thinks the local zone is. Without it,
 * the same order shows a different `paid_at` in development and in production.
 *
 * `supportBigNumbers` with `bigNumberStrings: false` keeps `BIGINT` money as a JavaScript
 * number: every amount the platform handles is far inside `Number.MAX_SAFE_INTEGER`, and
 * `Money` rejects anything that is not a safe integer, so an overflow surfaces loudly.
 */
export function createDatabase(url: string, poolSize: number): DatabaseHandle {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: poolSize,
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    // Every statement goes through Drizzle, which parameterises; multi-statement would only
    // widen the blast radius if a raw string ever slipped through.
    multipleStatements: false,
    enableKeepAlive: true,
  });

  const db = drizzle(pool, { schema, mode: 'default' });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

export { schema };
