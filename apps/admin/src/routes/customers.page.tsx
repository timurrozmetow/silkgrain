import type {
  AdminCustomerListResponse,
  AdminCustomerRow,
  CustomerStatus,
} from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import {
  Field,
  Input,
  Pagination,
  Select,
  Skeleton,
  StatusChip,
  type ChipTone,
} from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router';

import { apiGet } from '../lib/api';

/**
 * The customer list.
 *
 * Only people who hold accounts. A guest checkout writes an order with no customer row, and
 * grouping orders by email to invent one would claim an identity the checkout declines to claim -
 * so the empty state says where guest orders actually live rather than pretending they are here.
 *
 * Sorting by spend is the one question this screen exists for that no other screen answers.
 */
const route = getRouteApi('/customers');

const STATUS_TONE: Record<CustomerStatus, ChipTone> = {
  active: 'positive',
  blocked: 'negative',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'Every status' },
  { value: 'active', label: 'Active' },
  { value: 'blocked', label: 'Blocked' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'spend', label: 'Highest spend' },
];

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function Customers() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/customers' });

  const query = new URLSearchParams();
  if (search.q !== undefined) query.set('q', search.q);
  if (search.status !== undefined) query.set('status', search.status);
  if (search.sort !== undefined) query.set('sort', search.sort);
  query.set('page', String(search.page ?? 1));

  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'customers', query.toString()],
    queryFn: ({ signal }) =>
      apiGet<AdminCustomerListResponse>(`/admin/customers?${query.toString()}`, signal),
    placeholderData: (previous) => previous,
  });

  const patch = (next: Record<string, string | undefined>) => {
    void navigate({
      search: (previous) => {
        const merged = { ...previous, ...next, page: undefined };
        return Object.fromEntries(
          Object.entries(merged).filter(([, value]) => value !== undefined && value !== ''),
        );
      },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-admin-border bg-white p-5">
        <Field label="Search" className="min-w-[240px] flex-1">
          <Input
            iconLeft="magnifying-glass"
            placeholder="Name or email"
            defaultValue={search.q ?? ''}
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

        <Field label="Sort">
          <Select
            value={search.sort ?? 'newest'}
            options={SORT_OPTIONS}
            onChange={(event) => {
              patch({ sort: event.target.value === 'newest' ? undefined : event.target.value });
            }}
          />
        </Field>
      </div>

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-[20px] text-ink">Customers</h2>
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
            {search.q === undefined && search.status === undefined
              ? 'Nobody has registered yet.'
              : 'No account holders match those filters.'}{' '}
            {/* Said plainly, because "where are the guest orders" is the question this screen
                otherwise invites. */}
            Guest checkouts have no account; find their orders on the Orders screen by email.
          </p>
        ) : (
          <>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-admin-table border-collapse text-left">
                <thead>
                  <tr className="border-b border-admin-border">
                    {['Customer', 'Orders', 'Lifetime spend', 'Last order', 'Joined', 'Status'].map(
                      (heading) => (
                        <th
                          key={heading}
                          className="pb-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted"
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <CustomerRow key={row.id} row={row} />
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

function CustomerRow({ row }: { row: AdminCustomerRow }) {
  return (
    <tr className="border-b border-admin-border/60 last:border-0">
      <td className="max-w-[260px] py-3 pr-4">
        <Link
          to="/customers/$id"
          params={{ id: row.id }}
          className="truncate text-bodySm font-medium text-ink hover:text-green"
        >
          {row.name}
        </Link>
        <p className="truncate text-caption text-admin-muted">{row.email}</p>
      </td>
      <td className="py-3 pr-4 text-bodySm text-body-muted">{row.orderCount}</td>
      <td className="py-3 pr-4 text-bodySm font-medium text-ink">
        {Money.fromCents(row.lifetimeSpentCents).format()}
      </td>
      <td className="py-3 pr-4 text-bodySm text-body-muted">
        {row.lastOrderAt === null ? '—' : DATE.format(new Date(row.lastOrderAt))}
      </td>
      <td className="py-3 pr-4 text-bodySm text-body-muted">
        {DATE.format(new Date(row.createdAt))}
      </td>
      <td className="py-3">
        <StatusChip tone={STATUS_TONE[row.status]}>{row.status}</StatusChip>
      </td>
    </tr>
  );
}

export default Customers;
