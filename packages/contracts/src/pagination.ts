import { z } from 'zod';

/**
 * Offset pagination for anything an admin browses or a storefront paginates by number.
 *
 * `coerce` because these always arrive as query-string text. The upper bound on `perPage`
 * is a denial-of-service guard: without it a single request can ask for the whole table.
 */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
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
