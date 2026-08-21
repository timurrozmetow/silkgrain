import { createInterface } from 'node:readline/promises';

import { count, eq } from 'drizzle-orm';

import { loadDotEnv } from '../config/dotenv';
import { loadEnv } from '../env';
import { isMain } from '../lib/is-main';
import { hashPassword } from '../lib/password';

import { createDatabase, type Database } from './client';
import { redact } from './migrate';
import { adminUsers, settings, shippingRates } from './schema';

/**
 * The minimum a production database needs before the shop is operable at all.
 *
 * This exists because a freshly migrated database is not merely empty of catalogue - it is
 * missing three things that **no screen in the admin panel can create**, so without this command
 * the only route from a clean VPS to a working site is hand-written SQL in a deployment document.
 * That was the state task 9.7 found, and a runbook that tells an operator to INSERT rows by hand
 * at 2am is a stub wearing a document's clothes.
 *
 * What is missing, and why each one is unreachable:
 *
 *   `admin_users`     - every route that could create an administrator is behind `team:manage`,
 *                       which requires an administrator. There is no first one.
 *   `shipping_rates`  - the admin surface is `GET` and `PUT /:id` and deliberately has no `POST`
 *                       (`SHIPPING_METHOD` is a closed enum and `orders.shipping_method` stores a
 *                       snapshot of the code, so rows are edited and retired, never created). With
 *                       zero rows a checkout has nothing to select, and `GET /api/settings`
 *                       computes no `freeShippingFromCents`, so the storefront's own progress
 *                       meter has no figure to show.
 *   `settings`        - `saveSettings` reads the row, throws `notFound` when it is absent, and
 *                       then UPDATEs. It never inserts. An empty table is a Settings screen on
 *                       which nothing can be saved.
 *
 * This is emphatically **not** the seed. `db:seed` writes thirty-two demo products, fake orders
 * and three administrators sharing a password published in this repository, and it refuses to run
 * under `NODE_ENV=production` for exactly that reason (decision D-38). This command writes no
 * catalogue, no demo anything, and one administrator whose password the operator chooses. It is
 * meant to run in production; that is the whole point of it.
 *
 * It is safe to run twice. Every step checks first and skips what already exists, so a half-failed
 * bootstrap is finished by running it again rather than by working out which half ran.
 */

/** Decision D-2: the values the mockup quotes, which are also what the seed writes. */
const SHIPPING_RATES = [
  {
    code: 'standard' as const,
    name: 'Standard Shipping',
    description: 'Delivered in 3-5 business days.',
    priceCents: 799,
    freeAboveCents: 7500,
    estimatedDaysMin: 3,
    estimatedDaysMax: 5,
    position: 0,
  },
  {
    code: 'express' as const,
    name: 'Express Shipping',
    description: 'Delivered in 2-3 business days.',
    priceCents: 1299,
    freeAboveCents: null,
    estimatedDaysMin: 2,
    estimatedDaysMax: 3,
    position: 1,
  },
  {
    code: 'overnight' as const,
    name: 'Overnight',
    description: 'Ordered before 2pm CT, delivered next business day.',
    priceCents: 2499,
    freeAboveCents: null,
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    position: 2,
  },
];

/**
 * Only the keys the panel has an editor for.
 *
 * `SETTING_SPECS` in `packages/contracts` is the registry, and writing a key that is not in it
 * would produce a row the Settings screen shows as "no editor" - visible, unusable, and confusing
 * on day one. `store.name` and `ops.notification_email` are in the seed and have no consumer, so
 * they are not here either.
 *
 * The values are deliberately the shop's real ones rather than blanks: an empty announcement bar
 * renders an empty strip, and a tax rate of zero is a wrong number rather than an absent one.
 */
const SETTINGS_ROWS = [
  {
    key: 'commerce.default_tax_basis_points',
    // Texas state plus Houston local. The cart shows this as "Estimated Tax" (D-4); Stripe Tax is
    // authoritative once the address is known.
    value: 825,
    group: 'commerce',
    label: 'Estimated tax rate, basis points',
    description:
      'Shown in the cart as "Estimated Tax" (decision D-4). Stripe Tax is authoritative once ' +
      'the address is known at checkout.',
    isPublic: true,
  },
  {
    key: 'announcement.text',
    value: 'Complimentary shipping over $75 - Direct from family farms',
    group: 'content',
    label: 'Announcement bar',
    isPublic: true,
  },
  {
    key: 'store.contact_email',
    value: 'hello@silkgrain.example',
    group: 'general',
    label: 'Public contact address',
    isPublic: true,
  },
  {
    key: 'store.address',
    value: '5850 San Felipe St, Houston, TX 77057',
    group: 'general',
    label: 'Warehouse address',
    isPublic: true,
  },
];

export interface BootstrapOwner {
  email: string;
  name: string;
  password: string;
}

export interface BootstrapResult {
  ownerCreated: boolean;
  ratesCreated: number;
  settingsCreated: number;
}

export async function bootstrap(db: Database, owner: BootstrapOwner): Promise<BootstrapResult> {
  const result: BootstrapResult = { ownerCreated: false, ratesCreated: 0, settingsCreated: 0 };

  // ------------------------------------------------------------------ the first administrator
  const [existingAdmins] = await db.select({ total: count() }).from(adminUsers);
  if ((existingAdmins?.total ?? 0) > 0) {
    // Never a second owner from the command line. Once one account exists the Team screen is
    // reachable, and that screen is where authority is granted - with an audit entry naming who
    // granted it (D-36). A CLI that could keep minting owners is a CLI that bypasses the log.
    process.stdout.write('administrators already exist - skipping (use the Team screen)\n');
  } else {
    await db.insert(adminUsers).values({
      // Lowercased because `LoginInput` lowercases what is typed and `loginAdmin` matches with
      // `eq`. A row stored with a capital letter is an account nobody can ever sign in to, and
      // the failure looks exactly like a wrong password.
      email: owner.email.trim().toLowerCase(),
      passwordHash: await hashPassword(owner.password),
      name: owner.name.trim(),
      role: 'owner',
    });
    result.ownerCreated = true;
  }

  // ------------------------------------------------------------------------- shipping rates
  for (const rate of SHIPPING_RATES) {
    const [existing] = await db
      .select({ id: shippingRates.id })
      .from(shippingRates)
      .where(eq(shippingRates.code, rate.code));
    if (existing) continue;
    await db.insert(shippingRates).values(rate);
    result.ratesCreated += 1;
  }

  // ------------------------------------------------------------------------------- settings
  for (const row of SETTINGS_ROWS) {
    const [existing] = await db
      .select({ key: settings.key })
      .from(settings)
      .where(eq(settings.key, row.key));
    if (existing) continue;
    await db.insert(settings).values(row);
    result.settingsCreated += 1;
  }

  return result;
}

/**
 * Reads the owner's details, and never from `argv`.
 *
 * `ps` shows every argument of every running process to every user on the box, and the shell
 * keeps the rest in its history, so a password on the command line is a password on the machine
 * forever. Environment first, so an unattended install works; a prompt only when there is a
 * terminal to prompt at.
 *
 * The TTY check is not politeness. An earlier version always opened readline, and over a pipe or
 * under a CI runner - which is exactly where an unattended install happens - `question()` on an
 * exhausted stdin never resolves and the process hangs with no output. A deployment tool that
 * hangs is worse than one that refuses, because nobody knows whether to wait.
 */
async function readOwner(): Promise<BootstrapOwner> {
  const fromEnv = {
    email: process.env['BOOTSTRAP_OWNER_EMAIL'] ?? '',
    name: process.env['BOOTSTRAP_OWNER_NAME'] ?? '',
    password: process.env['BOOTSTRAP_OWNER_PASSWORD'] ?? '',
  };

  const missing = Object.entries(fromEnv)
    .filter(([, value]) => value === '')
    .map(([key]) => key);
  if (missing.length === 0) return fromEnv;

  if (!process.stdin.isTTY) {
    process.stderr.write(
      `no terminal to prompt at, and these are unset: ${missing.join(', ')}\n` +
        `Set BOOTSTRAP_OWNER_EMAIL, BOOTSTRAP_OWNER_NAME and BOOTSTRAP_OWNER_PASSWORD, or run\n` +
        `this from an interactive shell.\n`,
    );
    process.exit(2);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return {
      email: fromEnv.email === '' ? await rl.question('owner email: ') : fromEnv.email,
      name: fromEnv.name === '' ? await rl.question('owner name: ') : fromEnv.name,
      password:
        fromEnv.password === ''
          ? await rl.question('owner password (your terminal will echo it): ')
          : fromEnv.password,
    };
  } finally {
    rl.close();
  }
}

if (isMain(import.meta.url)) {
  loadDotEnv();
  const env = loadEnv();

  const owner = await readOwner();
  if (owner.email.trim() === '' || owner.name.trim() === '') {
    process.stderr.write('an email and a name are both required\n');
    process.exit(1);
  }
  // The same floor the panel enforces, checked here so the first account cannot be the weakest.
  if (owner.password.length < 10) {
    process.stderr.write('the password must be at least 10 characters\n');
    process.exit(1);
  }

  const handle = createDatabase(env.DATABASE_URL, env.DATABASE_POOL_SIZE);
  try {
    const done = await bootstrap(handle.db, owner);
    process.stdout.write(
      `bootstrapped ${redact(env.DATABASE_URL)}\n` +
        `  owner:          ${done.ownerCreated ? owner.email.trim().toLowerCase() : 'already present'}\n` +
        `  shipping rates: ${String(done.ratesCreated)} created\n` +
        `  settings:       ${String(done.settingsCreated)} created\n` +
        `\nThe catalogue is still empty; add products in the admin panel.\n`,
    );
  } finally {
    await handle.close();
  }
}
