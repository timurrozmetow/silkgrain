import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';

import { loadDotEnv } from '../config/dotenv';
import { loadEnv } from '../env';
import { isMain } from '../lib/is-main';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Applies every migration the journal has not recorded yet.
 *
 * A single connection rather than the pool: `drizzle-kit`'s migrator runs DDL and expects to
 * own the session, and a pooled connection could hand a half-migrated schema to a query
 * running in parallel.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: false });
  try {
    await migrate(drizzle(connection), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await connection.end();
  }
}

/** Keeps the password out of stdout and out of CI logs. */
export function redact(url: string): string {
  return url.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@');
}

if (isMain(import.meta.url)) {
  loadDotEnv();
  const env = loadEnv();
  await runMigrations(env.DATABASE_URL);
  process.stdout.write(`migrations applied to ${redact(env.DATABASE_URL)}\n`);
}
