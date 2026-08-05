import { PRODUCT_SORT, type ProductListResponse, type ProductSort } from '@silkgrain/contracts';
import { EmptyState, Eyebrow, Pagination, Select } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';

import { ButtonLink } from '../components/ButtonLink';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductGrid';
import { apiGet, queryString } from '../lib/api';

import { rootRoute } from './root';

/**
 * The catalogue.
 *
 * Filter state lives in the URL and nowhere else, so a filtered view can be shared, bookmarked
 * and reached with the back button. React state holding the same thing would be a second copy
 * that disagrees with the address bar the moment anyone presses Back.
 *
 * The sidebar of filters is the next piece of this page. Sorting, pagination and the results
 * bar are here because they are what the grid cannot be read without.
 */

/**
 * Every field optional, so a link to `/shop` need not restate the defaults.
 *
 * TanStack requires a `Link` to supply every non-optional search key, which would mean every
 * "View All Products" in the site spelling out `page: 1, sort: 'featured'` - and a URL
 * carrying its own defaults is a URL that looks filtered when it is not.
 */
export interface ShopSearch {
  page?: number;
  sort?: ProductSort;
  category?: string[];
}

const SORT_LABELS: Record<ProductSort, string> = {
  featured: 'Featured',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  newest: 'Newest',
  bestselling: 'Best selling',
  rating: 'Top rated',
};

const PER_PAGE = 16;

function asSort(value: unknown): ProductSort {
  return PRODUCT_SORT.includes(value as ProductSort) ? (value as ProductSort) : 'featured';
}

function asCategories(value: unknown): string[] | undefined {
  if (typeof value === 'string' && value.length > 0) return [value];
  if (Array.isArray(value)) {
    const list = value.filter((entry): entry is string => typeof entry === 'string');
    return list.length > 0 ? list : undefined;
  }
  return undefined;
}

function Shop() {
  const search = shopRoute.useSearch();
  const navigate = useNavigate({ from: shopRoute.fullPath });
  const page = search.page ?? 1;
  const sort = search.sort ?? 'featured';

  const query = queryString({
    page,
    perPage: PER_PAGE,
    sort,
    ...(search.category === undefined ? {} : { category: search.category }),
  });

  const { data, isPending, isError } = useQuery({
    queryKey: ['products', query],
    queryFn: ({ signal }) => apiGet<ProductListResponse>(`/products${query}`, signal),
    // The grid should not blank out while the next page loads; the previous one stays until
    // the new one is ready, which is what the numbered pagination in the design implies.
    placeholderData: (previous) => previous,
  });

  const meta = data?.meta;
  const first = meta === undefined || meta.total === 0 ? 0 : (meta.page - 1) * meta.perPage + 1;
  const last = meta === undefined ? 0 : Math.min(meta.page * meta.perPage, meta.total);

  return (
    <div className="mx-auto max-w-container px-gutter py-12 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-8">
      <Eyebrow>The pantry</Eyebrow>
      <h1 className="mt-3 font-serif text-[42px] leading-tight text-ink mobile:text-[30px]">
        Shop All Grains
      </h1>
      <p className="mt-3 max-w-[60ch] text-body text-body-muted">
        Rice, lentils, dried fruit and spices, bought direct from the families who grow them.
      </p>

      <div className="mt-10 flex items-center justify-between gap-6 border-b border-line pb-4 mobile:flex-col mobile:items-stretch mobile:gap-3">
        <p className="font-mono text-[12px] text-muted" aria-live="polite">
          {meta === undefined
            ? 'Loading products'
            : meta.total === 0
              ? 'No products'
              : `Showing ${String(first)}–${String(last)} of ${String(meta.total)} products`}
        </p>

        <div className="flex items-center gap-3 text-[13px] text-muted">
          <label htmlFor="shop-sort" className="shrink-0">
            Sort by
          </label>
          <Select
            id="shop-sort"
            value={sort}
            options={PRODUCT_SORT.map((option) => ({
              value: option,
              label: SORT_LABELS[option],
            }))}
            onChange={(event) => {
              void navigate({
                search: (previous) => ({ ...previous, sort: asSort(event.target.value), page: 1 }),
              });
            }}
          />
        </div>
      </div>

      <div className="mt-8">
        {isPending ? (
          <ProductGridSkeleton count={8} />
        ) : isError ? (
          <EmptyState
            icon="warning-circle"
            title="The catalogue could not be loaded"
            description="That is on us. Refreshing usually sorts it out."
          />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon="magnifying-glass"
            tone="green"
            title="Nothing matches those filters"
            description="Try widening the price range or clearing a category."
            action={<ButtonLink to="/shop">Clear filters</ButtonLink>}
          />
        ) : (
          <ProductGrid products={data.items} />
        )}
      </div>

      {meta !== undefined && meta.totalPages > 1 && (
        <div className="mt-12 flex justify-center">
          <Pagination
            page={meta.page}
            pageCount={meta.totalPages}
            onChange={(next: number) => {
              void navigate({ search: (previous) => ({ ...previous, page: next }) });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </div>
      )}
    </div>
  );
}

export const shopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shop',
  // Parsed rather than trusted: these come from the address bar, where anyone can type.
  validateSearch: (raw: Record<string, unknown>): ShopSearch => {
    const page = Number(raw['page']);
    const categories = asCategories(raw['category']);
    // Defaults are left out rather than written in, so `/shop` stays `/shop`.
    return {
      ...(Number.isInteger(page) && page > 1 ? { page } : {}),
      ...(raw['sort'] === undefined ? {} : { sort: asSort(raw['sort']) }),
      ...(categories === undefined ? {} : { category: categories }),
    };
  },
  component: Shop,
});
