import type { FastifyInstance } from 'fastify';
import mysql from 'mysql2/promise';

import { buildApp } from '../app';
import { loadDotEnv } from '../config/dotenv';
import { runMigrations } from '../db/migrate';
import { loadEnv } from '../env';

/**
 * Integration harness.
 *
 * The tests run against `silkgrain_test` on the same MySQL 8 instance as development, not
 * against sqlite or a mock. Every rule this schema enforces - the CHECK on stock, the unique
 * index on `webhook_events.event_id`, `STRICT_TRANS_TABLES` refusing a truncated value - only
 * exists in MySQL, so a test that does not touch MySQL cannot tell whether they hold.
 */

let migrated = false;

export function testEnv() {
  loadDotEnv();
  const url = process.env['DATABASE_URL_TEST'];
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Copy .env.example to .env; `pnpm setup:services` creates ' +
        'the silkgrain_test database.',
    );
  }
  return loadEnv({ ...process.env, DATABASE_URL: url, NODE_ENV: 'test', LOG_LEVEL: 'silent' });
}

/**
 * Tables the integration tests write to.
 *
 * Foreign-key checks are switched off around the truncation, so the order is for reading
 * rather than for the database. The catalogue and commerce configuration are included because
 * the catalogue and cart tests build their own fixture (`test/fixtures/catalog.ts`) instead of
 * running the real seed: assertions have to be checkable by eye, and the seed's thirty-two
 * products carry pseudo-random ratings and stock levels.
 */
const MUTABLE_TABLES = [
  'refresh_tokens',
  'wishlist_items',
  'wishlists',
  'reviews',
  'promo_redemptions',
  'promo_codes',
  'payments',
  'webhook_events',
  'addresses',
  'order_items',
  'orders',
  'inventory_movements',
  'product_nutrition',
  'product_certifications',
  'product_badges',
  'product_images',
  'product_variants',
  'products',
  'categories',
  'shipping_rates',
  'settings',
  'faqs',
  'contact_messages',
  'recipe_products',
  'recipes',
  'wholesale_request_notes',
  'wholesale_requests',
  // Every admin write now records one, so without this each test file leaks entries into the next.
  'audit_log',
  'customers',
  'admin_users',
];

export async function truncateAll(databaseUrl: string): Promise<void> {
  const connection = await mysql.createConnection({ uri: databaseUrl });
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of MUTABLE_TABLES) {
      await connection.query(`TRUNCATE TABLE \`${table}\``);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await connection.end();
  }
}

export async function buildTestApp(
  overrides: Partial<Parameters<typeof buildApp>[0]> = {},
): Promise<FastifyInstance> {
  const env = { ...testEnv(), ...overrides };

  // Migrating once per process rather than once per file: the journal makes it a no-op after
  // the first call, but the round trip is not free and every test file pays it otherwise.
  if (!migrated) {
    await runMigrations(env.DATABASE_URL);
    migrated = true;
  }
  await truncateAll(env.DATABASE_URL);

  const app = await buildApp(env);
  await app.ready();
  return app;
}

/**
 * A distinct client address per test.
 *
 * Rate limiting stays switched on in the tests - it is a behaviour worth covering - so each
 * test needs its own bucket, or the eleventh assertion in the file fails for a reason that has
 * nothing to do with what it is testing.
 */
let addressCounter = 0;
export function freshAddress(): string {
  addressCounter += 1;
  return `10.0.${String(Math.floor(addressCounter / 250))}.${String((addressCounter % 250) + 1)}`;
}

/** Pulls a `Set-Cookie` value out of a reply, so a test can present it on the next request. */
export function cookieFrom(headers: Record<string, unknown>, name: string): string | undefined {
  const raw = headers['set-cookie'];
  const list: string[] = Array.isArray(raw)
    ? (raw as unknown[]).map((entry) => String(entry))
    : typeof raw === 'string'
      ? [raw]
      : [];
  for (const entry of list) {
    const [pair] = entry.split(';');
    if (pair?.startsWith(`${name}=`)) {
      const value = pair.slice(name.length + 1);
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}
