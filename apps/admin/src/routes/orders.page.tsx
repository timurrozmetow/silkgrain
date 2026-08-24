import type { AdminOrderListResponse, AdminOrderRow, OrderStatus } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import {
  Checkbox,
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
 * The order list.
 *
 * Filter state lives in the URL, as the product list's does: an operator who filters to the
 * fulfilment queue and reloads expects to land back in it, and one who sends the link to a
 * colleague expects them to see the same rows.
 *
 * "Needs fulfilment" is one checkbox for two statuses, paid and processing, because that is the
 * queue a shipping desk actually works from and neither status alone describes it.
 */
const route = getRouteApi('/orders');

const STATUS_TONE: Record<OrderStatus, ChipTone> = {
  pending: 'warning',
  paid: 'info',
  processing: 'info',
  shipped: 'positive',
  delivered: 'positive',
  cancelled: 'neutral',
  refunded: 'negative',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'Every status' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'processing', label: 'Processing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'refunded', label: 'Refunded' },
];

const DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function Orders() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/orders' });

  const query = new URLSearchParams();
  if (search.q !== undefined) query.set('q', search.q);
  if (search.status !== undefined) query.set('status', search.status);
  if (search.needsFulfilment === true) query.set('needsFulfilment', 'true');
  query.set('page', String(search.page ?? 1));

  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'orders', query.toString()],
    queryFn: ({ signal }) =>
      apiGet<AdminOrderListResponse>(`/admin/orders?${query.toString()}`, signal),
    placeholderData: (previous) => previous,
  });

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
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-admin-border bg-white p-5">
        <Field label="Search" className="min-w-[240px] flex-1">
          <Input
            iconLeft="magnifying-glass"
            placeholder="Order number or email"
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

        <Checkbox
          label="Needs fulfilment"
          checked={search.needsFulfilment === true}
          onChange={(event) => {
            patch({ needsFulfilment: event.target.checked });
          }}
        />
      </div>

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-[20px] text-ink">Orders</h2>
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
          <p className="mt-5 text-bodySm text-admin-muted">No orders match those filters.</p>
        ) : (
          <>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-admin-table border-collapse text-left">
                <thead>
                  <tr className="border-b border-admin-border">
                    {['Order', 'Placed', 'Customer', 'Items', 'Total', 'Status'].map((heading) => (
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
                    <OrderRow key={row.orderNumber} row={row} />
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

function OrderRow({ row }: { row: AdminOrderRow }) {
  return (
    <tr className="border-b border-admin-border/60 last:border-0">
      <td className="py-3 pr-4">
        <Link
          to="/orders/$orderNumber"
          params={{ orderNumber: row.orderNumber }}
          className="font-mono text-[12px] font-medium text-ink hover:text-green"
        >
          {row.orderNumber}
        </Link>
      </td>
      <td className="py-3 pr-4 text-bodySm text-body-muted">
        {DATE.format(new Date(row.createdAt))}
      </td>
      <td className="max-w-[220px] py-3 pr-4">
        <p className="truncate text-bodySm text-ink">{row.customerName ?? 'Guest'}</p>
        <p className="truncate text-caption text-admin-muted">{row.email}</p>
      </td>
      <td className="py-3 pr-4 text-bodySm text-body-muted">{row.itemCount}</td>
      <td className="py-3 pr-4 text-bodySm font-medium text-ink">
        {Money.fromCents(row.totalCents).format()}
      </td>
      <td className="py-3">
        <StatusChip tone={STATUS_TONE[row.status]}>{row.status}</StatusChip>
      </td>
    </tr>
  );
}

export default Orders;
