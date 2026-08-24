import type {
  AdminWholesaleListResponse,
  AdminWholesaleRow,
  BusinessType,
  VolumeBand,
  WholesaleStatus,
} from '@silkgrain/contracts';
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
 * Wholesale enquiries.
 *
 * The default view is everything, newest first, because a desk works from what just arrived. The
 * "unassigned" tick is the one that matters day to day: it is the queue nobody has taken, which is
 * the difference between an enquiry being handled slowly and not at all.
 */
const route = getRouteApi('/wholesale');

const STATUS_TONE: Record<WholesaleStatus, ChipTone> = {
  new: 'info',
  contacted: 'warning',
  quoted: 'warning',
  converted: 'positive',
  declined: 'neutral',
};

export const BUSINESS_LABEL: Record<BusinessType, string> = {
  restaurant: 'Restaurant',
  grocery: 'Grocery',
  distributor: 'Distributor',
  meal_kit: 'Meal kit',
  other: 'Other',
};

/** The bands are pounds a month; the raw values read as ranges once labelled. */
export const VOLUME_LABEL: Record<VolumeBand, string> = {
  '50-200': '50–200 lb',
  '200-500': '200–500 lb',
  '500-2000': '500–2,000 lb',
  '2000+': '2,000+ lb',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'Every status' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'converted', label: 'Converted' },
  { value: 'declined', label: 'Declined' },
];

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function Wholesale() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/wholesale' });

  const query = new URLSearchParams();
  if (search.q !== undefined) query.set('q', search.q);
  if (search.status !== undefined) query.set('status', search.status);
  if (search.unassigned === true) query.set('unassigned', 'true');
  query.set('page', String(search.page ?? 1));

  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'wholesale', query.toString()],
    queryFn: ({ signal }) =>
      apiGet<AdminWholesaleListResponse>(`/admin/wholesale/requests?${query.toString()}`, signal),
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
            placeholder="Business name or email"
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
          label="Nobody has taken it"
          checked={search.unassigned === true}
          onChange={(event) => {
            patch({ unassigned: event.target.checked });
          }}
        />
      </div>

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-[20px] text-ink">Wholesale enquiries</h2>
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
          <p className="mt-5 text-bodySm text-admin-muted">
            {search.q === undefined && search.status === undefined && search.unassigned !== true
              ? 'No wholesale enquiries yet. The form on /wholesale is where they arrive.'
              : 'No enquiries match those filters.'}
          </p>
        ) : (
          <>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-admin-table border-collapse text-left">
                <thead>
                  <tr className="border-b border-admin-border">
                    {['Business', 'Contact', 'Volume', 'Received', 'Owner', 'Status'].map(
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
                    <EnquiryRow key={row.id} row={row} />
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

function EnquiryRow({ row }: { row: AdminWholesaleRow }) {
  return (
    <tr className="border-b border-admin-border/60 last:border-0">
      <td className="max-w-[240px] py-3 pr-4">
        <Link
          to="/wholesale/$id"
          params={{ id: row.id }}
          className="truncate text-bodySm font-medium text-ink hover:text-green"
        >
          {row.businessName}
        </Link>
        <p className="truncate text-caption text-admin-muted">
          {BUSINESS_LABEL[row.businessType]}
          {row.noteCount > 0 && ` · ${String(row.noteCount)} note${row.noteCount === 1 ? '' : 's'}`}
        </p>
      </td>
      <td className="max-w-[220px] py-3 pr-4">
        <p className="truncate text-bodySm text-ink">{row.contactName}</p>
        <p className="truncate text-caption text-admin-muted">{row.email}</p>
      </td>
      <td className="py-3 pr-4 text-bodySm text-body-muted">
        {VOLUME_LABEL[row.monthlyVolumeBand]}
      </td>
      <td className="py-3 pr-4 text-bodySm text-body-muted">
        {DATE.format(new Date(row.createdAt))}
      </td>
      <td className="py-3 pr-4 text-bodySm text-body-muted">
        {row.assignedToName ?? <span className="text-admin-muted">Nobody</span>}
      </td>
      <td className="py-3">
        <StatusChip tone={STATUS_TONE[row.status]}>{row.status}</StatusChip>
      </td>
    </tr>
  );
}

export default Wholesale;
