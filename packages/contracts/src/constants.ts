/**
 * Plain constants, free of Zod - a third entry point beside `money`, and for the same reason.
 *
 * A storefront needs a handful of literal values from this package: the quantity a cart line
 * stops at, the sort options a `<Select>` lists. Importing them from the barrel costs Zod and
 * every schema in the repository - 146 KB of sources in the storefront bundle, measured, for
 * two arrays. Type imports are erased by the compiler and cost nothing; these are values, and
 * values are what pull a module graph behind them.
 *
 * Nothing here may import Zod, directly or transitively. The schema modules import *from* here
 * and build on top, so there is still one definition of each value.
 */

/**
 * The most of one variant a single cart line may hold.
 *
 * Both a UI bound - the quantity stepper stops here - and a server rule, because a line of
 * 100,000 bags is either a mistake or an attack on the stock ledger.
 */
export const CART_LINE_MAX_QTY = 99;

/**
 * How the catalogue can be sorted. `featured` is the default everywhere.
 *
 * The order is the order the sort control lists them in, so it is data, not decoration -
 * rearranging this array rearranges the dropdown on `/shop` and every category page.
 */
export const PRODUCT_SORT = [
  'featured',
  'price_asc',
  'price_desc',
  'newest',
  'bestselling',
  'rating',
] as const;

/**
 * Product enum values the admin form's selects need Zod-free.
 *
 * The single source is still here: `enums.ts` imports these arrays and wraps each in `z.enum`, so
 * the tuple and the schema cannot drift. Only the arrays live here; the schemas stay in `enums.ts`.
 */
export const ORIGIN = ['UZ', 'KZ', 'TM', 'KG', 'TJ', 'MIXED'] as const;
export const WEIGHT_UNIT = ['lb', 'oz', 'g', 'kit'] as const;
export const CERTIFICATION = ['organic', 'non_gmo', 'halal', 'kosher', 'gluten_free'] as const;
export const PRODUCT_BADGE = ['bestseller', 'new', 'premium'] as const;
export const PRODUCT_STATUS = ['draft', 'active', 'archived'] as const;

/** The wholesale form's two selects. Both orders are the order the options are listed in. */
export const BUSINESS_TYPE = ['restaurant', 'grocery', 'distributor', 'meal_kit', 'other'] as const;

/** Monthly volume in pounds, as offered by the mockup's select. */
export const VOLUME_BAND = ['50-200', '200-500', '500-2000', '2000+'] as const;
