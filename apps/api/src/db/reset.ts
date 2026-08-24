import mysql from 'mysql2/promise';

import { loadDotEnv } from '../config/dotenv';
import { loadEnv } from '../env';
import { isMain } from '../lib/is-main';

import { redact, runMigrations } from './migrate';

/**
 * Drops every table in the target database, including Drizzle's own migration journal.
 *
 * This is the rollback story, and it is deliberate. `drizzle-kit` generates forward-only
 * migrations - there is no `down.sql` to run - so "roll back" in development means drop and
 * re-apply, and in production it means restore the backup that `scripts/backup-db.sh` took
 * before the deploy. Pretending a hand-written down migration exists would be worse: it is
 * the one piece of SQL nobody ever tests until the night they need it.
 *
 * Two refusals, and they guard different mistakes.
 *
 * The name check stops a mistyped `DATABASE_URL` from emptying something else on the same server.
 * It does nothing about the worse case, which is the *correct* URL in the wrong environment: the
 * production database is called `silkgrain` too, so on its own that check would wave through a
 * `DROP TABLE` over every table the shop owns. Hence the second refusal, on `NODE_ENV`. Recovery
 * in production is restoring the pre-deploy dump (decision D-17), never this.
 */
export async function resetDatabase(databaseUrl: string, nodeEnv?: string): Promise<number> {
  if (nodeEnv === 'production') {
    throw new Error(
      'Refusing to reset a production database. Recovery in production is restoring the ' +
        'pre-deploy dump taken by scripts/backup-db.sh (decision D-17), not dropping every table.',
    );
  }

  const name = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!/^silkgrain(_test)?$/.test(name)) {
    throw new Error(
      `Refusing to reset "${name}": only silkgrain and silkgrain_test may be dropped this way.`,
    );
  }

  const connection = await mysql.createConnection({ uri: databaseUrl });
  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?',
      [name],
    );
    const tables = rows.map((row) => String(row['name']));
    if (tables.length === 0) return 0;

    // Foreign keys are dropped along with the tables, so the order does not matter once the
    // checks are off - which beats computing a topological order that a future FK breaks.
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) {
      await connection.query(`DROP TABLE IF EXISTS \`${table.replace(/`/g, '')}\``);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    return tables.length;
  } finally {
    await connection.end();
  }
}

if (isMain(import.meta.url)) {
  loadDotEnv();
  const env = loadEnv();
  const dropped = await resetDatabase(env.DATABASE_URL, env.NODE_ENV);
  process.stdout.write(`dropped ${String(dropped)} tables from ${redact(env.DATABASE_URL)}\n`);
  await runMigrations(env.DATABASE_URL);
  process.stdout.write('migrations re-applied\n');
}
