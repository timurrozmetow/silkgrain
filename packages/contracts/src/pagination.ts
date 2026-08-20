import { z } from 'zod';

/**
 * Offset pagination for anything an admin browses or a storefront paginates by number.
 *
 * `coerce` because these always arrive as query-string text. Both bounds are denial-of-service
 * guards: without the one on `perPage` a single request can ask for the whole table, and without
 * the one on `page` it can ask for an OFFSET past what MySQL will parse, which is a 500 on a
 * public endpoint rather than the 422 a bad number deserves. `perPage` had its cap from the
 * start and `page` did not, which left the guard half-built.
 */
export const PAGE_MAX = 100_000;

/**
 * The page number itself, so the bound is written once.
 *
 * Six schemas declared this field independently and all six had the same hole. Reuse `.default()`
 * on it rather than restating the chain - Zod returns a new schema from every modifier, so sharing
 * the base is safe.
 */
export const PageNumber = z.coerce.number().int().min(1).max(PAGE_MAX);

export const PageQuery = z.object({
  page: PageNumber.default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(24),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const PageMeta = z.object({
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasPrevious: z.boolean(),
  hasNext: z.boolean(),
});
export type PageMeta = z.infer<typeof PageMeta>;

/**
 * Wraps a row schema into `{ items, meta }`.
 *
 * A generic function rather than a fixed shape so the OpenAPI document describes the actual
 * item type on every paginated route instead of `unknown[]`.
 */
export function paginated<Item extends z.ZodTypeAny>(
  item: Item,
): z.ZodObject<{ items: z.ZodArray<Item>; meta: typeof PageMeta }> {
  return z.object({ items: z.array(item), meta: PageMeta });
}

export function pageMeta(page: number, perPage: number, total: number): PageMeta {
  const totalPages = Math.ceil(total / perPage);
  return {
    page,
    perPage,
    total,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}

/** Translates a validated `PageQuery` into the `LIMIT`/`OFFSET` a query needs. */
export function pageBounds({ page, perPage }: PageQuery): { limit: number; offset: number } {
  return { limit: perPage, offset: (page - 1) * perPage };
}
