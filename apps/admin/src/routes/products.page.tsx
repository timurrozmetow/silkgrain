import type {
  AdminProductListResponse,
  AdminProductRow,
  CategoryListResponse,
  ProductStatus,
} from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import {
  Checkbox,
  Field,
  Icon,
  Input,
  Pagination,
  Select,
  Skeleton,
  StatusChip,
  buttonClasses,
  type ChipTone,
} from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router';

import { apiGet } from '../lib/api';

/**
 * The product list.
 *
 * Filter state lives in the URL, as the storefront's does, and for a sharper reason here: an
 * operator who filters to the low-stock rows and sends the link to a colleague expects them to see
 * the same list, and an operator who reloads after saving expects to land where they were.
 *
 * Everything in the table comes from `GET /api/admin/products`, which starts from every product
 * rather than from what a customer may see - so drafts and archived rows are here, marked.
 */
const route = getRouteApi('/products');

const STATUS_TONE: Record<ProductStatus, ChipTone> = {
  active: 'positive',
  draft: 'warning',
  archived: 'neutral',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'Every status' },
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

function Products() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/products' });

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => apiGet<CategoryListResponse>('/categories', signal),
  });

  const query = new URLSearchParams();
  if (search.q !== undefined) query.set('q', search.q);
  if (search.status !== undefined) query.set('status', search.status);
  if (search.category !== undefined) query.set('category', search.category);
  if (search.lowStock === true) query.set('lowStock', 'true');
  query.set('page', String(search.page ?? 1));

  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'products', query.toString()],
    queryFn: ({ signal }) =>
      apiGet<AdminProductListResponse>(`/admin/products?${query.toString()}`, signal),
    // The list should not blank out while the next page or a narrower filter loads.
    placeholderData: (previous) => previous,
  });

  /** Any filter change returns to page one: page four of a narrower result is usually empty. */
  const patch = (next: Record<string, string | boolean | undefined>) => {
    void navigate({
      search: (previous) => {
        const merged = { ...previous, ...next, page: undefined };
        return Object.fromEntries(
          Object.entries(merged).filter(
            ([, value]) => value !== undefined && value !== '' && value !== false,
          ),
        );
      },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Link to="/products/new" className={buttonClasses({ className: 'gap-2' })}>
          <Icon name="plus" size={16} />
          Add product
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-admin-border bg-white p-5">
        <Field label="Search" className="min-w-[240px] flex-1">
          <Input
            iconLeft="magnifying-glass"
            placeholder="Name, slug or SKU"
            defaultValue={search.q ?? ''}
            // Committed on Enter or blur rather than per keystroke: every change is a request and
            // a history entry, and an operator typing "devzira" would leave seven of each.
            onKeyDown={(event) => {
              if (event.key === 'Enter') patch({ q: event.currentTarget.value.trim() });
            }}
            onBlur={(event) => {
              if ((event.currentTarget.value.trim() || undefined) !== search.q) {
                patch({ q: event.currentTarget.value.trim() });
              }
            }}
          />
        </Field>

        <Field label="Status">
          <Select
            value={search.status ?? 'all'}
            options={STATUS_OPTIONS}
            onChange={(event) => {
              patch({ status: event.target.value === 'all' ? undefined : event.target.value });
            }}
          />
        </Field>

        <Field label="Category">
          <Select
            value={search.category ?? ''}
            options={[
              { value: '', label: 'Every category' },
              ...(categories?.items ?? []).map((category) => ({
                value: category.slug,
                label: category.name,
              })),
            ]}
            onChange={(event) => {
              patch({ category: event.target.value === '' ? undefined : event.target.value });
            }}
          />
        </Field>

        <Checkbox
          label="Needs restocking"
          checked={search.lowStock === true}
          onChange={(event) => {
            patch({ lowStock: event.target.checked });
          }}
        />
      </div>

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-[20px] text-ink">Products</h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-admin-muted">
            {data === undefined ? '' : `${String(data.meta.total)} total`}
          </span>
        </div>

        {isError ? (
          <p className="mt-5 text-bodySm text-terracotta">
            The list could not be loaded. Refreshing usually sorts it out.
          </p>
        ) : isPending ? (
          <div className="mt-5 flex flex-col gap-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <p className="mt-5 text-bodySm text-admin-muted">
            Nothing matches those filters. Clearing the search is usually the fix.
          </p>
        ) : (
          <>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-admin-table border-collapse text-left">
                <thead>
                  <tr className="border-b border-admin-border">
                    {[
                      'Product',
                      'Category',
                      'Variants',
                      'From',
                      'Stock',
                      'Nutrition',
                      'Status',
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="pb-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <ProductRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>

            {data.meta.totalPages > 1 && (
              <Pagination
                className="mt-6"
                page={data.meta.page}
                pageCount={data.meta.totalPages}
                onChange={(page) => {
                  void navigate({ search: (previous) => ({ ...previous, page }) });
                }}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

function ProductRow({ row }: { row: AdminProductRow }) {
  return (
    <tr className="border-b border-admin-line last:border-0">
      <td className="py-3 pr-4">
        <div className="flex items-center gap-3">
          {row.imageUrl === null ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-admin-border bg-admin-bg text-admin-muted">
              <Icon name="package" size={16} />
            </span>
          ) : (
            <img
              src={row.imageUrl}
              alt=""
              loading="lazy"
              className="h-10 w-10 shrink-0 rounded-md border border-admin-border object-cover"
            />
          )}
          <div className="min-w-0">
            <Link
              to="/products/$id/edit"
              params={{ id: row.id }}
              className="truncate text-bodySm font-medium text-ink hover:text-green"
            >
              {row.name}
              {row.isFeatured && (
                <Icon
                  name="star"
                  weight="fill"
                  size={12}
                  className="ml-1.5 inline text-gold"
                  label="Featured"
                />
              )}
            </Link>
            <p className="truncate font-mono text-[11px] text-admin-muted">{row.slug}</p>
          </div>
        </div>
      </td>

      <td className="py-3 pr-4 text-bodySm text-body-muted">{row.categoryName}</td>
      <td className="py-3 pr-4 font-mono text-[12.5px] text-body-muted">{row.variantCount}</td>
      <td className="py-3 pr-4 font-mono text-[12.5px] text-ink">
        {row.priceFromCents === null ? (
          <span className="text-admin-muted" title="No active variant to price">
            —
          </span>
        ) : (
          Money.fromCents(row.priceFromCents).format()
        )}
      </td>
      <td className="py-3 pr-4 font-mono text-[12.5px]">
        <span className={row.stockTotal === 0 ? 'text-terracotta' : 'text-body-muted'}>
          {row.stockTotal}
        </span>
      </td>
      <td className="py-3 pr-4">
        {/* Decision D-20: the seed's panels are category-level averages, and an editor deciding
            what to verify next needs to see which products still carry them. */}
        {row.nutritionSource === null ? (
          <span className="font-mono text-[11px] text-admin-muted">None</span>
        ) : row.nutritionSource === 'entered' ? (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-green-muted">
            <Icon name="check" weight="bold" size={11} />
            Entered
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-gold-dark">
            <Icon name="info" size={11} />
            Reference
          </span>
        )}
      </td>
      <td className="py-3">
        <StatusChip tone={STATUS_TONE[row.status]}>{row.status}</StatusChip>
      </td>
    </tr>
  );
}

export default Products;
