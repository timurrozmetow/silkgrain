import {
  type AdminSettingRow,
  type AdminSettingValue,
  type AdminSettings,
  type AdminSettingsInput,
  type AdminShippingRate,
  type AdminShippingRateInput,
  type PublicSettings,
  SETTING_SPECS,
  type SettingKey,
  isSettingKey,
} from '@silkgrain/contracts';
import { asc, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { settings, shippingRates } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';

/**
 * Settings and shipping rates, read and written from one screen.
 *
 * One screen and one payload, which is decision D-22 rather than a convenience: the announcement
 * copy that says "free shipping over $75" is edited beside the rate row the checkout actually
 * charges from, and both figures come from the same read. Two endpoints seconds apart could print
 * two different numbers, which is exactly the confusion the decision exists to prevent.
 *
 * Rates can be edited and retired, never created or deleted. `SHIPPING_METHOD` is a closed enum and
 * `orders.shipping_method` holds a snapshot of the code rather than a foreign key, so a deleted rate
 * leaves every past order naming something that no longer exists.
 */

/** The registry's order within a group. Not expressible in SQL, and stating it twice invites drift. */
const KEY_ORDER = new Map(Object.keys(SETTING_SPECS).map((key, index) => [key, index]));

/**
 * The stored JSON, read through the registry.
 *
 * Total by construction: a key with no registry entry is `unregistered`, and a registered key whose
 * stored value fails its schema is `malformed` carrying the kind it should have been. Neither is an
 * error - both are states the database can genuinely be in, and a 500 on the screen whose job is to
 * fix them would be the worst possible answer.
 */
function readValue(key: string, raw: unknown): AdminSettingValue {
  if (!isSettingKey(key)) {
    return { kind: 'unregistered', json: JSON.stringify(raw ?? null) };
  }

  const spec = SETTING_SPECS[key];
  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) {
    return { kind: 'malformed', expected: spec.kind, json: JSON.stringify(raw ?? null) };
  }

  return spec.kind === 'basisPoints'
    ? { kind: 'basisPoints', value: parsed.data as number }
    : { kind: spec.kind, value: parsed.data as string };
}

function toRateView(row: typeof shippingRates.$inferSelect): AdminShippingRate {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    freeAboveCents: row.freeAboveCents,
    estimatedDaysMin: row.estimatedDaysMin,
    estimatedDaysMax: row.estimatedDaysMax,
    isActive: row.isActive,
    position: row.position,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The shipping rates alone.
 *
 * Split out because `loadSettings` is an unfiltered read of a table whose own schema comment says a
 * non-public row is where an API key would live - the seed already carries an internal ops address
 * - so the whole payload is owner and manager only (D-31). This is the half a support agent
 * genuinely needs: it answers "why was I charged postage" and "when will it arrive", and it
 * contains nothing but prices and delivery estimates the storefront already prints.
 */
export async function loadShippingRates(db: Database): Promise<AdminShippingRate[]> {
  const rates = await db
    .select()
    .from(shippingRates)
    .orderBy(asc(shippingRates.position), asc(shippingRates.id));
  return rates.map(toRateView);
}

export async function loadSettings(db: Database): Promise<AdminSettings> {
  const [rows, rates] = await Promise.all([
    db.select().from(settings),
    db.select().from(shippingRates).orderBy(asc(shippingRates.position), asc(shippingRates.id)),
  ]);

  const values: AdminSettingRow[] = rows
    .map((row) => ({
      key: row.key,
      group: row.group,
      label: row.label,
      description: row.description,
      isPublic: row.isPublic,
      value: readValue(row.key, row.value),
      updatedAt: row.updatedAt.toISOString(),
    }))
    // Group, then the registry's declaration order, then the key. Unregistered rows sort after
    // every registered one within their group rather than interleaving unpredictably.
    .sort(
      (left, right) =>
        left.group.localeCompare(right.group) ||
        (KEY_ORDER.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
          (KEY_ORDER.get(right.key) ?? Number.MAX_SAFE_INTEGER) ||
        left.key.localeCompare(right.key),
    );

  return { values, shippingRates: rates.map(toRateView) };
}

/**
 * Writes the keys the body carried, all of them or none.
 *
 * A key with no row is a 404 rather than an insert: the seed owns which settings exist, and a
 * `PUT` that quietly created one would let a typo'd key become a permanent row nothing reads.
 */
export async function saveSettings(
  db: Database,
  input: AdminSettingsInput,
): Promise<AdminSettings> {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined) as [
    SettingKey,
    string | number,
  ][];

  await db.transaction(async (tx) => {
    for (const [key, value] of entries) {
      const result = await tx.update(settings).set({ value }).where(eq(settings.key, key));
      if (result[0].affectedRows === 0) throw notFound(`Setting ${key}`);
    }
  });

  return loadSettings(db);
}

/**
 * Edits one rate.
 *
 * Refused with 409 when it would leave the shop with no active method, because a checkout with
 * nothing to select is a shop that cannot take an order - and the operator who unticked the last
 * one meant to retire a method, not to close. The count and the write share a transaction, so two
 * operators retiring the last two rates cannot both pass the check.
 */
export async function saveShippingRate(
  db: Database,
  id: number,
  input: AdminShippingRateInput,
): Promise<AdminSettings> {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(shippingRates).for('update');
    const target = rows.find((row) => row.id === id);
    if (!target) throw notFound('Shipping rate');

    const stillActive = rows.filter((row) =>
      row.id === id ? input.isActive : row.isActive,
    ).length;
    if (stillActive === 0) {
      throw new AppError(
        'CONFLICT',
        'That would leave no active shipping method, and a checkout needs one',
      );
    }

    await tx
      .update(shippingRates)
      .set({
        name: input.name,
        description: input.description,
        priceCents: input.priceCents,
        freeAboveCents: input.freeAboveCents,
        estimatedDaysMin: input.estimatedDaysMin,
        estimatedDaysMax: input.estimatedDaysMax,
        isActive: input.isActive,
        position: input.position,
      })
      .where(eq(shippingRates.id, id));
  });

  return loadSettings(db);
}

/**
 * What the storefront reads.
 *
 * `freeShippingFromCents` is the lowest live threshold among active rates - the same rule the cart's
 * own progress bar applies, because it is the nearest one a customer can reach. It is computed here
 * rather than stored so the announcement bar cannot promise a figure the checkout does not honour,
 * which is what D-22 is about.
 *
 * A malformed or missing row degrades to null rather than throwing. This endpoint is on the
 * critical path of every page load, and a bad announcement string must not take the shop down.
 */
export async function loadPublicSettings(db: Database): Promise<PublicSettings> {
  const [rows, rates] = await Promise.all([
    db.select().from(settings).where(eq(settings.isPublic, true)),
    db.select().from(shippingRates).where(eq(shippingRates.isActive, true)),
  ]);

  const text = (key: SettingKey): string | null => {
    const row = rows.find((entry) => entry.key === key);
    if (!row) return null;
    const value = readValue(key, row.value);
    return value.kind === 'text' || value.kind === 'email' ? value.value : null;
  };

  const thresholds = rates
    .map((rate) => rate.freeAboveCents)
    .filter((value): value is number => value !== null && value > 0);

  return {
    announcementText: text('announcement.text'),
    contactEmail: text('store.contact_email'),
    address: text('store.address'),
    freeShippingFromCents: thresholds.length === 0 ? null : Math.min(...thresholds),
  };
}
