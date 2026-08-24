import { z } from 'zod';

import { ShippingMethod } from '../enums';
import { Cents, Email, Id } from '../primitives';

/**
 * What a setting may hold.
 *
 * `settings.value` is a JSON column, so a key can change shape without a migration - and so
 * nothing whatsoever guarantees the shape at read time. A generic editor over that column is a way
 * to take the shop down: type `"8.25%"` into `commerce.default_tax_basis_points` and every cart
 * quote starts falling back to the default while the panel shows the value it "saved".
 *
 * The registry below owns the *type* of a key. The row keeps owning the *copy* - `label`,
 * `description`, `group`, `is_public` - because the schema comment already says `group` is what the
 * settings screen renders its sections from, and a second copy of a label is a second place it can
 * be wrong.
 *
 * It lives here rather than in `constants.ts` because it holds Zod schemas, and that file is the
 * deliberately Zod-free entry point the browser bundles.
 */
export const SettingKind = z.enum(['text', 'email', 'basisPoints']);
export type SettingKind = z.infer<typeof SettingKind>;

/**
 * Every key the panel offers an editor for.
 *
 * Four, not the seven the seed writes. `store.name`, `ops.notification_email` and
 * `commerce.free_shipping_threshold_cents` are absent on purpose - the first two have no consumer,
 * and the third is decision D-22: `shipping_rates.free_above_cents` is the authority on free
 * shipping because the checkout charges from it, so the panel offers exactly one editable
 * free-shipping figure and it is the one in the rate row. An editor for a number nothing reads is a
 * text input that lies.
 *
 * Declaration order is the order the panel lists keys within a group, so no fourth place states it.
 */
export const SETTING_SPECS = {
  'commerce.default_tax_basis_points': {
    kind: 'basisPoints',
    // 20 % is far above any US combined rate; the point is to refuse a typo'd 825000, not to
    // legislate. Zero is legal: a state with no sales tax is a real place.
    schema: z.number().int().min(0).max(2000),
  },
  'announcement.text': {
    kind: 'text',
    schema: z.string().trim().min(1).max(160),
  },
  'store.contact_email': {
    kind: 'email',
    schema: Email,
  },
  'store.address': {
    kind: 'text',
    schema: z.string().trim().min(1).max(200),
  },
} as const satisfies Record<string, { kind: SettingKind; schema: z.ZodTypeAny }>;

export type SettingKey = keyof typeof SETTING_SPECS;
export const SETTING_KEYS = Object.keys(SETTING_SPECS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_SPECS, key);
}

/**
 * One setting's value as the panel receives it.
 *
 * A response schema is a serialiser, so this read has to be total: the column is nullable JSON and
 * a hand-edit in Studio can leave anything in it. A loose `z.union([z.string(), z.number()])` would
 * serialise a malformed row happily and push the problem into the client, where it becomes a blank
 * input that silently overwrites the wrong thing.
 *
 * `malformed` carries the kind the registry expected, so a broken tax value can be fixed from the
 * panel rather than only from MySQL. `unregistered` is shown and never edited: the row exists, the
 * operator should be able to see that it exists, and nothing here knows what it may hold.
 */
export const AdminSettingValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string() }),
  z.object({ kind: z.literal('email'), value: z.string() }),
  z.object({ kind: z.literal('basisPoints'), value: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('malformed'), expected: SettingKind, json: z.string() }),
  z.object({ kind: z.literal('unregistered'), json: z.string() }),
]);
export type AdminSettingValue = z.infer<typeof AdminSettingValue>;

/**
 * A settings row.
 *
 * `key`, `group` and `label` are plain strings rather than enums because the table can hold rows
 * the registry has never heard of - the seed may grow, and a hand-inserted row is a Tuesday. A
 * response schema that enumerated the known keys would 500 on the first unknown one instead of
 * rendering it.
 */
export const AdminSettingRow = z.object({
  key: z.string(),
  group: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  /** Read-only here. Flipping it is how an internal address reaches the storefront. */
  isPublic: z.boolean(),
  value: AdminSettingValue,
  updatedAt: z.string(),
});
export type AdminSettingRow = z.infer<typeof AdminSettingRow>;

/**
 * A shipping rate as the panel reads one.
 *
 * Deliberately looser than the input below: the day counts are `nonnegative` on the way out and
 * `min(1)` on the way in. The table has no CHECK forbidding a zero-day estimate, so a serialiser
 * demanding `positive()` would turn one legacy row into a 500 on the very screen whose job is to
 * let somebody fix it. Inputs tighten; serialisers tolerate what the database can already hold.
 */
export const AdminShippingRate = z.object({
  id: Id,
  code: ShippingMethod,
  name: z.string(),
  description: z.string().nullable(),
  priceCents: Cents,
  freeAboveCents: Cents.nullable(),
  estimatedDaysMin: z.number().int().nonnegative(),
  estimatedDaysMax: z.number().int().nonnegative(),
  isActive: z.boolean(),
  position: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type AdminShippingRate = z.infer<typeof AdminShippingRate>;

/**
 * The whole settings screen in one payload.
 *
 * One read, and that is a D-22 decision rather than a convenience: the announcement copy is edited
 * beside a line stating what the checkout actually charges from, and that line has to come from the
 * same read as the rate it quotes. Two endpoints seconds apart could print two different numbers,
 * which is precisely the confusion the decision exists to prevent.
 */
export const AdminSettings = z.object({
  values: z.array(AdminSettingRow),
  shippingRates: z.array(AdminShippingRate),
});
export type AdminSettings = z.infer<typeof AdminSettings>;

/**
 * A partial batch of settings, derived from the registry so a key's type is stated exactly once.
 *
 * An object of optional keys rather than a `z.record`: `.strict()` then rejects
 * `commerce.default_tax_basis_pointz` at the type provider, with a 422 and no service code, and
 * each field carries its own exact bound so the form can refuse 82.5 % before a request is made.
 */
export const AdminSettingsInput = z
  .object({
    'commerce.default_tax_basis_points':
      SETTING_SPECS['commerce.default_tax_basis_points'].schema.optional(),
    'announcement.text': SETTING_SPECS['announcement.text'].schema.optional(),
    'store.contact_email': SETTING_SPECS['store.contact_email'].schema.optional(),
    'store.address': SETTING_SPECS['store.address'].schema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change');
export type AdminSettingsInput = z.infer<typeof AdminSettingsInput>;

/**
 * A shipping rate as the panel writes one.
 *
 * No `code` and no `id`: `.strict()` turns an attempt to rename a method into a 422, because
 * `orders.shipping_method` holds a snapshot of the code rather than a foreign key, and renaming one
 * would relabel every past order shipped by it.
 *
 * The three refinements mirror the table's own CHECKs and one rule the table cannot express, so the
 * operator gets a message rather than a 500 from MySQL.
 */
export const AdminShippingRateInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(200).nullable(),
    priceCents: Cents.max(50_000),
    freeAboveCents: Cents.nullable(),
    estimatedDaysMin: z.number().int().min(1).max(60),
    estimatedDaysMax: z.number().int().min(1).max(60),
    isActive: z.boolean(),
    position: z.number().int().min(0).max(100),
  })
  .strict()
  .refine((rate) => rate.estimatedDaysMax >= rate.estimatedDaysMin, {
    message: 'The longest estimate cannot be shorter than the shortest',
    path: ['estimatedDaysMax'],
  })
  .refine((rate) => rate.freeAboveCents === null || rate.freeAboveCents > 0, {
    message:
      'A threshold of zero makes this method free for everyone. Set the price to zero instead.',
    path: ['freeAboveCents'],
  })
  .refine((rate) => rate.priceCents > 0 || rate.freeAboveCents === null, {
    message: 'A method that is already free has no threshold to cross',
    path: ['freeAboveCents'],
  });
export type AdminShippingRateInput = z.infer<typeof AdminShippingRateInput>;

/**
 * What the storefront is told.
 *
 * Every field nullable, because a missing or malformed row must degrade to "render nothing" rather
 * than fail: the announcement bar keeps its height and shows no text.
 *
 * `freeShippingFromCents` is computed from the shipping rates, by the same rule the cart's own
 * progress bar uses - the lowest live threshold on offer. It is here so the three places that
 * hard-coded "$75" can read the number the checkout actually charges from, which is what D-22
 * asks for. A fourth copy of the figure, editable or not, would be the thing D-22 forbids.
 */
export const PublicSettings = z.object({
  announcementText: z.string().nullable(),
  contactEmail: z.string().nullable(),
  address: z.string().nullable(),
  freeShippingFromCents: z.number().int().positive().nullable(),
});
export type PublicSettings = z.infer<typeof PublicSettings>;
