import type {
  CategoryListResponse,
  CategoryNode,
  CategorySummary,
  ProductListResponse,
} from '@silkgrain/contracts';
import { PRODUCT_SORT } from '@silkgrain/contracts/constants';
import { Breadcrumb, EmptyState, Icon, Pagination, Select, isIconName } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router';

import { ButtonLink } from '../components/ButtonLink';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductGrid';
import { apiGet, queryString } from '../lib/api';
import { breadcrumbJsonLd, Seo } from '../lib/seo';

import type { CategorySearch } from './category';
import { SORT_LABELS, asSort } from './search-params';

/**
 * A category landing page.
 *
 * Distinct from `/shop?category=rice` on purpose: this one has its own address, its own
 * canonical, its own title and its own copy, which is what makes it worth a search result.
 * The filtered shop view canonicalises away precisely so this page can be the one that ranks.
 *
 * Sub-category chips come from the tree's `children`, so a branch appears here the moment an
 * editor creates one - and "All" is the parent itself, which the API already folds children
 * into (decision D-21).
 *
 * `getRouteApi` rather than importing `categoryRoute`: that route lazily imports this module,
 * and importing it back would be a cycle.
 */
const route = getRouteApi('/shop/c/$slug');

const PER_PAGE = 12;

/** Finds a top-level category or, failing that, the parent of a child with this slug. */
function locate(
  tree: CategoryNode[] | undefined,
  slug: string,
): { node: CategoryNode; children: CategorySummary[] } | undefined {
  const node = tree?.find((candidate) => candidate.slug === slug);
  return node === undefined ? undefined : { node, children: node.children };
}

function Category() {
  const { slug } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/shop/c/$slug' });

  const page = search.page ?? 1;
  const sort = search.sort ?? 'featured';
  const active = search.child ?? slug;

  const { data: tree } = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => apiGet<CategoryListResponse>('/categories', signal),
  });

  const found = locate(tree?.items, slug);

  const query = queryString({ category: [active], page, perPage: PER_PAGE, sort });
  const { data, isPending, isError } = useQuery({
    queryKey: ['products', query],
    queryFn: ({ signal }) => apiGet<ProductListResponse>(`/products${query}`, signal),
    placeholderData: (previous) => previous,
  });

  // The tree is the authority on whether this slug is a category at all. Until it arrives the
  // page renders its frame; once it has, an unknown slug is a dead end and says so.
  if (tree !== undefined && found === undefined) {
    return (
      <div className="mx-auto max-w-container px-gutter py-24 tablet:px-gutter-tablet mobile:px-gutter-mobile">
        <EmptyState
          icon="magnifying-glass"
          tone="green"
          title="No such category"
          description="It may have been renamed, or the link may have a typo in it."
          action={<ButtonLink to="/shop">Browse everything</ButtonLink>}
        />
      </div>
    );
  }

  const category = found?.node;
  const meta = data?.meta;

  return (
    <>
      {category !== undefined && (
        <Seo
          title={`${category.name} — SilkGrain`}
          description={
            category.description ??
            `${category.name} from Central Asia, bought direct from the growers.`
          }
          canonicalPath={`/shop/c/${category.slug}`}
          imageUrl={category.imageUrl}
          jsonLd={breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Shop', path: '/shop' },
            { name: category.name, path: `/shop/c/${category.slug}` },
          ])}
        />
      )}

      {/* 320px full-bleed hero. The photograph is a gradient until real imagery exists (Q-8). */}
      <section className="relative flex h-[320px] items-end overflow-hidden bg-green-deep mobile:h-[220px]">
        {category?.imageUrl != null && (
          <img
            src={category.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(12,40,29,0.82)] to-[rgba(12,40,29,0.35)]" />
        <div className="relative mx-auto w-full max-w-container px-gutter pb-10 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:pb-6">
          <Breadcrumb
            tone="dark"
            items={[
              { label: 'Home', href: '/' },
              { label: 'Shop', href: '/shop' },
              { label: category?.name ?? '…' },
            ]}
          />
          <h1 className="mt-4 flex items-center gap-4 font-display text-[52px] font-medium leading-tight text-ondeep mobile:text-[32px]">
            {category !== undefined && isIconName(category.icon) && (
              <Icon name={category.icon} size={38} className="text-gold mobile:hidden" />
            )}
            {category?.name ?? ''}
          </h1>
          {category?.description != null && (
            <p className="mt-3 max-w-[58ch] text-bodySm text-ondeep-muted">
              {category.description}
            </p>
          )}
          <p className="mt-4 font-mono text-[12px] uppercase tracking-[0.16em] text-gold">
            {meta === undefined ? '' : `${String(meta.total)} products`}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-container px-gutter py-10 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-6">
        {found !== undefined && found.children.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            <Chip label={`All ${found.node.name}`} active={search.child === undefined} to={slug} />
            {found.children.map((child) => (
              <Chip
                key={child.slug}
                label={child.name}
                active={search.child === child.slug}
                to={slug}
                child={child.slug}
              />
            ))}
          </ul>
        )}

        <div className="mt-8 flex items-center justify-between gap-6 border-b border-line pb-4 mobile:flex-col mobile:items-stretch mobile:gap-3">
          <p className="font-mono text-[12px] text-muted" aria-live="polite">
            {meta === undefined
              ? 'Loading products'
              : meta.total === 0
                ? 'No products'
                : `Showing ${String((meta.page - 1) * meta.perPage + 1)}–${String(
                    Math.min(meta.page * meta.perPage, meta.total),
                  )} of ${String(meta.total)} products`}
          </p>

          <div className="flex items-center gap-3 text-[13px] text-muted">
            <label htmlFor="category-sort" className="shrink-0">
              Sort by
            </label>
            <Select
              id="category-sort"
              value={sort}
              options={PRODUCT_SORT.map((option) => ({
                value: option,
                label: SORT_LABELS[option],
              }))}
              onChange={(event) => {
                void navigate({
                  // Sorting returns to page one; page 3 of a re-sorted list is a different
                  // set of products than the one the reader was looking at.
                  search: (previous): CategorySearch => ({
                    ...(previous.child === undefined ? {} : { child: previous.child }),
                    sort: asSort(event.target.value),
                  }),
                });
              }}
            />
          </div>
        </div>

        <div className="mt-8">
          {isPending ? (
            <ProductGridSkeleton count={6} />
          ) : isError ? (
            <EmptyState
              icon="warning-circle"
              title="This category could not be loaded"
              description="That is on us. Refreshing usually sorts it out."
            />
          ) : data.items.length === 0 ? (
            <EmptyState
              icon="bowl-food"
              tone="green"
              title="Nothing in here yet"
              description="This shelf is being restocked."
              action={<ButtonLink to="/shop">Browse everything</ButtonLink>}
            />
          ) : (
            <ProductGrid products={data.items} columns={3} />
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
    </>
  );
}

function Chip({
  label,
  active,
  to,
  child,
}: {
  label: string;
  active: boolean;
  to: string;
  child?: string;
}) {
  return (
    <li>
      <Link
        to="/shop/c/$slug"
        params={{ slug: to }}
        search={child === undefined ? {} : { child }}
        className={`flex min-h-[40px] items-center rounded-full border px-4 text-[13px] transition-colors ${
          active
            ? 'border-green bg-green text-white'
            : 'border-line bg-surface text-ink hover:border-green'
        }`}
      >
        {label}
      </Link>
    </li>
  );
}

export default Category;
