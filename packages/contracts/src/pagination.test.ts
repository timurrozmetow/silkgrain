import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PageQuery, pageBounds, pageMeta, paginated } from './pagination';

/**
 * Offset pagination, on its own.
 *
 * Every paginated list in the system builds its footer from `pageMeta` and its SQL from
 * `pageBounds`, so an off-by-one here is an off-by-one everywhere at once - a "Next" button on the
 * last page, or a second page that repeats the first page's last row. The arithmetic is four lines
 * and worth pinning exactly.
 */
describe('page bounds', () => {
  it('turns a page number into the offset a query needs', () => {
    expect(pageBounds({ page: 1, perPage: 24 })).toEqual({ limit: 24, offset: 0 });
    expect(pageBounds({ page: 2, perPage: 24 })).toEqual({ limit: 24, offset: 24 });
    expect(pageBounds({ page: 5, perPage: 20 })).toEqual({ limit: 20, offset: 80 });
  });

  it('starts the first page at zero, not at one', () => {
    // The classic off-by-one: an offset of 1 on page one silently drops the newest row from
    // every list in the system.
    expect(pageBounds({ page: 1, perPage: 50 }).offset).toBe(0);
  });
});

describe('page meta', () => {
  it('counts the pages a total needs', () => {
    expect(pageMeta(1, 20, 100).totalPages).toBe(5);
    // A partial last page still counts.
    expect(pageMeta(1, 20, 101).totalPages).toBe(6);
    expect(pageMeta(1, 20, 1).totalPages).toBe(1);
  });

  it('reports no pages at all for an empty result', () => {
    const meta = pageMeta(1, 20, 0);
    expect(meta.totalPages).toBe(0);
    // Neither direction leads anywhere, and page one of nothing is still page one.
    expect(meta.hasPrevious).toBe(false);
    expect(meta.hasNext).toBe(false);
  });

  it('offers Next everywhere except the last page', () => {
    expect(pageMeta(1, 20, 100).hasNext).toBe(true);
    expect(pageMeta(4, 20, 100).hasNext).toBe(true);
    // Exactly five pages of twenty: page five is the end, and an exact multiple is where an
    // off-by-one would show a Next button that leads to an empty list.
    expect(pageMeta(5, 20, 100).hasNext).toBe(false);
  });

  it('offers Previous everywhere except the first page', () => {
    expect(pageMeta(1, 20, 100).hasPrevious).toBe(false);
    expect(pageMeta(2, 20, 100).hasPrevious).toBe(true);
  });

  it('does not invent a Next when a page is past the end', () => {
    // Reachable by hand-editing the URL, which the storefront treats as hostile input.
    const meta = pageMeta(9, 20, 100);
    expect(meta.hasNext).toBe(false);
    expect(meta.hasPrevious).toBe(true);
  });
});

describe('the page query', () => {
  it('coerces query-string text, because that is all a URL can carry', () => {
    expect(PageQuery.parse({ page: '3', perPage: '50' })).toEqual({ page: 3, perPage: 50 });
  });

  it('defaults to the first page', () => {
    expect(PageQuery.parse({})).toEqual({ page: 1, perPage: 24 });
  });

  it('refuses a page size that would ask for the whole table', () => {
    // The upper bound is a denial-of-service guard, not a preference.
    expect(PageQuery.safeParse({ perPage: '1000' }).success).toBe(false);
    expect(PageQuery.safeParse({ page: '0' }).success).toBe(false);
    expect(PageQuery.safeParse({ page: '-1' }).success).toBe(false);
    expect(PageQuery.safeParse({ page: '1.5' }).success).toBe(false);
  });
});

describe('the paginated wrapper', () => {
  it('describes the actual item type rather than an unknown array', () => {
    // A generic function rather than a fixed shape, so the OpenAPI document names the row type
    // on every paginated route. A wrapper that erased it would document `unknown[]` everywhere.
    const schema = paginated(z.object({ sku: z.string() }));

    const parsed = schema.parse({
      items: [{ sku: 'SG-DEV-2LB' }],
      meta: pageMeta(1, 24, 1),
    });
    expect(parsed.items[0]?.sku).toBe('SG-DEV-2LB');

    // And it still refuses a row of the wrong shape.
    expect(schema.safeParse({ items: [{ sku: 7 }], meta: pageMeta(1, 24, 1) }).success).toBe(false);
  });
});
