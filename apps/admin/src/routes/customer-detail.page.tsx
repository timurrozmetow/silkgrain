import type { AdminCustomerDetail, CustomerStatus, OrderStatus } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Button, Icon, Skeleton, StatusChip, type ChipTone } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';

import { ApiRequestError, apiGet, apiPatch } from '../lib/api';
import { useCan } from '../lib/permissions';

/**
 * One customer.
 *
 * Read-only but for one control, and the control is the point: blocking somebody is a claim about
 * what they can still do, so the panel says plainly what it does - the sessions end now, not when
 * the token happens to expire.
 *
 * There is no Reset password, no Edit email, no address book. Each would either manufacture a fact
 * only the customer can create or open a way into their account; they are in BACKLOG.md by name.
 */
const route = getRouteApi('/customers/$id');

const STATUS_TONE: Record<CustomerStatus, ChipTone> = {
  active: 'positive',
  blocked: 'negative',
};

const ORDER_TONE: Record<OrderStatus, ChipTone> = {
  pending: 'warning',
  paid: 'info',
  processing: 'info',
  shipped: 'positive',
  delivered: 'positive',
  cancelled: 'neutral',
  refunded: 'negative',
};

const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function CustomerDetail() {
  const { id } = route.useParams();

  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'customer', id],
    queryFn: ({ signal }) => apiGet<AdminCustomerDetail>(`/admin/customers/${String(id)}`, signal),
  });

  const [customer, setCustomer] = useState<AdminCustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const current = customer ?? data ?? null;

  async function setStatus(status: CustomerStatus) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setCustomer(
        await apiPatch<AdminCustomerDetail>(`/admin/customers/${String(id)}/status`, { status }),
      );
      setConfirming(false);
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.status === 403
            ? 'Your role cannot suspend an account.'
            : cause.message
          : 'That did not work.',
      );
    } finally {
      setBusy(false);
    }
  }

  // Above every early return: React counts hooks by call order, so one below a `return` would
  // shift every hook after it on the render that bails out.
  const mayBlock = useCan('customers:block');

  if (isError) {
    return (
      <p className="rounded-lg border border-admin-border bg-white p-6 text-bodySm text-terracotta">
        No customer with that id.
      </p>
    );
  }

  if (isPending || current === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const blocked = current.status === 'blocked';

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          to="/customers"
          className="inline-flex items-center gap-1.5 text-caption text-admin-muted hover:text-green"
        >
          <Icon name="arrow-left" size={13} />
          All customers
        </Link>
        <h2 className="mt-1 flex flex-wrap items-center gap-3 font-serif text-[24px] text-ink">
          {current.name}
          <StatusChip tone={STATUS_TONE[current.status]}>{current.status}</StatusChip>
        </h2>
        <p className="mt-1 text-bodySm text-body-muted">
          {current.email} · joined {DATE.format(new Date(current.createdAt))}
        </p>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="rounded-lg border border-terracotta/40 bg-terracotta-bg px-5 py-3 text-bodySm text-terracotta"
        >
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-4 tablet:grid-cols-1">
        <Stat label="Orders" value={String(current.orderCount)} />
        <Stat
          label="Lifetime spend"
          value={Money.fromCents(current.lifetimeSpentCents).format()}
          note="Paid, processing, shipped and delivered"
        />
        <Stat
          label="Last seen"
          value={
            current.lastLoginAt === null
              ? 'Never signed in'
              : DATE.format(new Date(current.lastLoginAt))
          }
        />
      </div>

      <section className="rounded-lg border border-admin-border bg-white p-5 shadow-card">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h3 className="font-serif text-[17px] text-ink">Account</h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted">
            Status is the only editable field
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-bodySm mobile:grid-cols-1">
          <Row label="Phone" value={current.phone ?? '—'} />
          <Row label="Marketing consent" value={current.marketingOptIn ? 'Given' : 'Not given'} />
        </dl>

        {confirming ? (
          <div className="mt-4 rounded-md border border-admin-border bg-admin-bg p-4">
            <p className="text-bodySm text-body-muted">
              {blocked
                ? 'Restoring the account lets them sign in again. Any session from before the suspension stays ended, so they will have to sign in.'
                : 'Suspending ends every session now — not when the token expires — and refuses the next sign-in. Their orders are untouched.'}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <Button
                size="sm"
                variant={blocked ? 'primary' : 'outline'}
                loading={busy}
                onClick={() => {
                  void setStatus(blocked ? 'active' : 'blocked');
                }}
              >
                {blocked ? 'Restore the account' : 'Suspend the account'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Never mind
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              className="mt-4"
              disabled={busy || !mayBlock}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {blocked ? 'Restore account' : 'Suspend account'}
            </Button>
            {/* Disabled with a reason rather than hidden: a support agent who reaches this page is
                answering a ticket about the customer, and knowing the lever exists - and who has
                it - is part of the answer. */}
            {!mayBlock && (
              <p className="mt-2 text-caption text-admin-muted">
                A manager or the owner suspends an account.
              </p>
            )}
          </>
        )}
      </section>

      <section className="rounded-lg border border-admin-border bg-white p-5 shadow-card">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h3 className="font-serif text-[17px] text-ink">Recent orders</h3>
          {current.orderCount > current.recentOrders.length && (
            <Link
              to="/orders"
              search={{ q: current.email }}
              className="text-caption text-green hover:underline"
            >
              All {current.orderCount} orders
            </Link>
          )}
        </div>

        {current.recentOrders.length === 0 ? (
          <p className="text-bodySm text-admin-muted">This account has never placed an order.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <tbody>
                {current.recentOrders.map((order) => (
                  <tr
                    key={order.orderNumber}
                    className="border-b border-admin-border/60 last:border-0"
                  >
                    <td className="py-2.5 pr-4">
                      <Link
                        to="/orders/$orderNumber"
                        params={{ orderNumber: order.orderNumber }}
                        className="font-mono text-[12px] text-ink hover:text-green"
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4 text-bodySm text-body-muted">
                      {DATE_TIME.format(new Date(order.createdAt))}
                    </td>
                    <td className="py-2.5 pr-4 text-bodySm text-body-muted">
                      {order.itemCount} items
                    </td>
                    <td className="py-2.5 pr-4 text-bodySm font-medium text-ink">
                      {Money.fromCents(order.totalCents).format()}
                    </td>
                    <td className="py-2.5">
                      <StatusChip tone={ORDER_TONE[order.status]}>{order.status}</StatusChip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-admin-border bg-white p-5 shadow-card">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted">{label}</p>
      <p className="mt-1.5 font-serif text-[22px] text-ink">{value}</p>
      {note !== undefined && <p className="mt-1 text-caption text-admin-muted">{note}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-body-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

export default CustomerDetail;
