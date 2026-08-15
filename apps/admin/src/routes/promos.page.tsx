import type {
  AdminPromoDiscount,
  AdminPromoListResponse,
  AdminPromoRow,
  PromoState,
} from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import {
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
 * The promo-code list.
 *
 * Every row's state is derived by the server in the cart evaluator's own order and printed as a
 * chip, so a code that reads "live" here is one the cart would actually accept. The state filter is
 * the same rule in SQL, so ticking "expired" and reading a chip that says "live" is a bug a test
 * catches, not a thing an operator has to notice.
 */
const route = getRouteApi('/promos');

const STATE_TONE: Record<PromoState, ChipTone> = {
  live: 'positive',
  scheduled: 'info',
  exhausted: 'warning',
  expired: 'neutral',
  disabled: 'negative',
};

const STATE_OPTIONS = [
  { value: 'all', label: 'Every state' },
  { value: 'live', label: 'Live' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'exhausted', label: 'Exhausted' },
  { value: 'expired', label: 'Expired' },
  { value: 'disabled', label: 'Disabled' },
];

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The one place a promo discount becomes a phrase, so the list and the form cannot word it apart. */
export function discountLabel(discount: AdminPromoDiscount): string {
  switch (discount.type) {
    case 'percent': {
      const cap =
        discount.maxDiscountCents === null
          ? ''
          : ` up to ${Money.fromCents(discount.maxDiscountCents).format()}`;
      return `${String(discount.basisPoints / 100)}% off${cap}`;
    }
    case 'fixed':
      return `${Money.fromCents(discount.amountCents).format()} off`;
    case 'free_shipping':
      return 'Free shipping';
  }
}

function Promos() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/promos' });

  const query = new URLSearchParams();
  if (search.q !== undefined) query.set('q', search.q);
  if (search.state !== undefined) query.set('state', search.state);
  query.set('page', String(search.page ?? 1));

  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'promos', query.toString()],
    queryFn: ({ signal }) =>
      apiGet<AdminPromoListResponse>(`/admin/promos?${query.toString()}`, signal),
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
      <div className="flex justify-end">
        <Link to="/promos/new" className={buttonClasses({ className: 'gap-2' })}>
          <Icon name="plus" size={16} />
          New code
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-admin-border bg-white p-5">
        <Field label="Search" className="min-w-[240px] flex-1">
          <Input
            iconLeft="magnifying-glass"
            placeholder="Code or description"
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

        <Field label="State">
          <Select
            value={search.state ?? 'all'}
            options={STATE_OPTIONS}
            onChange={(event) => {
              patch({ state: event.target.value === 'all' ? undefined : event.target.value });
            }}
          />
        </Field>
      </div>

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-[20px] text-ink">Promo codes</h2>
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
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <p className="mt-5 text-bodySm text-admin-muted">No codes match those filters.</p>
        ) : (
          <>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-admin-table border-collapse text-left">
                <thead>
                  <tr className="border-b border-admin-border">
                    {['Code', 'Discount', 'Used', 'Window', 'State'].map((heading) => (
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
                    <PromoRow key={row.id} row={row} />
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

function PromoRow({ row }: { row: AdminPromoRow }) {
  const used =
    row.usageLimit === null
      ? String(row.usedCount)
      : `${String(row.usedCount)} / ${String(row.usageLimit)}`;
  const window =
    row.startsAt === null && row.endsAt === null
      ? 'Always'
      : `${row.startsAt === null ? '—' : DATE.format(new Date(row.startsAt))} → ${
          row.endsAt === null ? '—' : DATE.format(new Date(row.endsAt))
        }`;

  return (
    <tr className="border-b border-admin-border/60 last:border-0">
      <td className="py-3 pr-4">
        <Link
          to="/promos/$id"
          params={{ id: row.id }}
          className="font-mono text-[13px] font-medium text-ink hover:text-green"
        >
          {row.code}
        </Link>
        {row.description !== null && (
          <p className="truncate text-caption text-admin-muted">{row.description}</p>
        )}
      </td>
      <td className="py-3 pr-4 text-bodySm text-body-muted">{discountLabel(row.discount)}</td>
      <td className="py-3 pr-4 text-bodySm text-body-muted">{used}</td>
      <td className="py-3 pr-4 text-bodySm text-body-muted">{window}</td>
      <td className="py-3">
        <StatusChip tone={STATE_TONE[row.state]}>{row.state}</StatusChip>
      </td>
    </tr>
  );
}

export default Promos;
