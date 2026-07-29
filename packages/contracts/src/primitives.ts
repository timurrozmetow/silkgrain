import { z } from 'zod';

/** Database surrogate key. */
export const Id = z.number().int().positive();

/**
 * Money is always whole cents, never a float.
 * `nonnegative` because every amount we transport (price, subtotal, tax, discount)
 * is a magnitude; direction is expressed by the field name, not by the sign.
 */
export const Cents = z.number().int().nonnegative();

/** URL-safe identifier: lowercase words joined by single hyphens. */
export const Slug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be lowercase words separated by single hyphens');

/** RFC 5321 caps the whole address at 254 characters. */
export const Email = z.string().trim().toLowerCase().email().max(254);

/** ISO 8601 with an explicit offset, so the client never has to guess the timezone. */
export const IsoDate = z.string().datetime({ offset: true });

/** US ZIP, five digits or ZIP+4. */
export const Zip = z.string().regex(/^\d{5}(-\d{4})?$/, 'Enter a valid US ZIP code');

/** North American phone number, punctuation optional. */
export const Phone = z
  .string()
  .regex(/^\+?1?[-. ]?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}$/, 'Enter a valid US phone number');

/** The 50 states plus DC — everything Stripe Tax needs for a US-only storefront. */
export const UsState = z.enum([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'DC',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
]);

/** Single-currency storefront. Kept as a schema so multi-currency stays a one-file change. */
export const Currency = z.literal('USD');

export type Id = z.infer<typeof Id>;
export type Cents = z.infer<typeof Cents>;
export type Slug = z.infer<typeof Slug>;
export type Email = z.infer<typeof Email>;
export type IsoDate = z.infer<typeof IsoDate>;
export type UsState = z.infer<typeof UsState>;
export type Currency = z.infer<typeof Currency>;
