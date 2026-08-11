import type { ProductListResponse } from '@silkgrain/contracts';
import { PRODUCT_SORT } from '@silkgrain/contracts/constants';
import { EmptyState, Eyebrow, Pagination, Select } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';

import { ButtonLink } from '../components/ButtonLink';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductGrid';
import {
  FilterSidebar,
  type FilterPatch,
  type FilterValues,
} from '../components/shop/FilterSidebar';
import { apiGet, queryString } from '../lib/api';
import { Seo } from '../lib/seo';

import { SORT_LABELS, asSort } from './search-params';
import type { ShopSearch } from './shop';

/**
 * The catalogue.
 *
 * Filter state lives in the URL and nowhere else, so a filtered view can be shared, bookmarked
 * and reached with the back button. React state holding the same thing would be a second copy
 * that disagrees with the address bar the moment anyone presses Back.
 *
 * The sidebar's lists all come from `facets`, which the server computes with each facet's own
 * filter removed - so ticking a box never collapses its own list, and nothing here is
 * hard-coded from the mockup.
 *
 * `getRouteApi` rather than importing `shopRoute`: this module is what that route lazily
 * imports, and importing it back would be a cycle.
 */
const route = getRouteApi('/shop');

const PER_PAGE = 16;

function Shop() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/shop' });
  const page = search.page ?? 1;
  const sort = search.sort ?? 'featured';

  const query = queryString({
    page,
    perPage: PER_PAGE,
    sort,
    // Split back out, so the request carries a repeated key per value.
    ...(search.category === undefined ? {} : { category: search.category.split(',') }),
    ...(search.origin === undefined ? {} : { origin: search.origin.split(',') }),
    ...(search.cert === undefined ? {} : { cert: search.cert.split(',') }),
    ...(search.weight === undefined ? {} : { weight: search.weight.split(',') }),
    ...(search.priceMinCents === undefined ? {} : { priceMinCents: search.priceMinCents }),
    ...(search.priceMaxCents === undefined ? {} : { priceMaxCents: search.priceMaxCents }),
    ...(search.inStock === true ? { inStock: true } : {}),
    ...(search.q === undefined ? {} : { q: search.q }),
  });

  const { data, isPending, isError } = useQuery({
    queryKey: ['products', query],
    queryFn: ({ signal }) => apiGet<ProductListResponse>(`/products${query}`, signal),
    // The grid should not blank out while the next page loads; the previous one stays until
    // the new one is ready, which is what the numbered pagination in the design implies.
    placeholderData: (previous) => previous,
  });

  const filters: FilterValues = {
    ...(search.category === undefined ? {} : { category: search.category }),
    ...(search.origin === undefined ? {} : { origin: search.origin }),
    ...(search.cert === undefined ? {} : { cert: search.cert }),
    ...(search.weight === undefined ? {} : { weight: search.weight }),
    ...(search.priceMinCents === undefined ? {} : { priceMinCents: search.priceMinCents }),
    ...(search.priceMaxCents === undefined ? {} : { priceMaxCents: search.priceMaxCents }),
    ...(search.inStock === undefined ? {} : { inStock: search.inStock }),
  };
  const anyFilterSet = Object.keys(filters).length > 0;

  /** Any filter change returns to page one: page 4 of a narrower result is usually empty. */
  const applyFilters = (next: FilterPatch) => {
    void navigate({
      search: (previous): ShopSearch => {
        // Page one, and a cleared filter leaves the URL entirely rather than lingering as an
        // empty value that makes an unfiltered view look filtered. Rebuilt rather than
        // deleted from, because `delete` on a computed key is banned here and rightly so.
        const merged = { ...previous, ...next, page: undefined };
        return Object.fromEntries(
          Object.entries(merged).filter(
            ([, value]) => value !== undefined && value !== '' && value !== false,
          ),
        );
      },
    });
  };

  const meta = data?.meta;
  const first = meta === undefined || meta.total === 0 ? 0 : (meta.page - 1) * meta.perPage + 1;
  const last = meta === undefined ? 0 : Math.min(meta.page * meta.perPage, meta.total);

  return (
    <div className="mx-auto max-w-container px-gutter py-12 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-8">
      <Seo
        title={search.q === undefined ? 'Shop all grains — SilkGrain' : `“${search.q}” — SilkGrain`}
        description="Rice, lentils, dried fruit and spices, bought direct from the families who grow them and shipped fresh from Houston."
        // Every filtered, sorted and paginated view points at the bare /shop. Pointing each
        // combination at itself is how thirty products become ten thousand indexed pages.
        canonicalPath="/shop"
        // A search result is one visitor's query, not a page of the catalogue.
        noIndex={search.q !== undefined}
      />
      <Eyebrow>{search.q === undefined ? 'The pantry' : 'Search results'}</Eyebrow>
      <h1 className="mt-3 font-serif text-[42px] leading-tight text-ink mobile:text-[30px]">
        {search.q === undefined ? 'Shop All Grains' : `“${search.q}”`}
      </h1>
      <p className="mt-3 max-w-[60ch] text-body text-body-muted">
        {search.q === undefined
          ? 'Rice, lentils, dried fruit and spices, bought direct from the families who grow them.'
          : 'Matching name, description and category.'}
      </p>

      <div className="mt-10 flex items-start gap-10 tablet:flex-col tablet:gap-6">
        <FilterSidebar
          facets={data?.facets}
          values={filters}
          onChange={applyFilters}
          active={anyFilterSet}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-6 border-b border-line pb-4 mobile:flex-col mobile:items-stretch mobile:gap-3">
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
                    search: (previous) => ({
                      ...previous,
                      sort: asSort(event.target.value),
                      page: 1,
                    }),
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
      </div>
    </div>
  );
}

export default Shop;
