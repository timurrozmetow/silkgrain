import type { AdminOrderDetail, OrderStatus } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import {
  Button,
  Field,
  Icon,
  Input,
  Skeleton,
  StatusChip,
  Textarea,
  type ChipTone,
} from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';

import { ApiRequestError, apiGet, apiPatch, apiPut } from '../lib/api';

/**
 * One order, and the four things a person does to it: move it along, record what was sent, write
 * down what happened, and read what was bought.
 *
 * The action buttons come from `allowedTransitions`, which the server computes from the transition
 * map - so the panel cannot offer a move the API would refuse, and adding a state to the map does
 * not mean editing a list here as well. `refunded` never appears: a refund is money leaving the
 * account, recorded when the provider reports it, and a button that wrote it locally would tell a
 * customer they had been paid back when nothing had.
 */
const route = getRouteApi('/orders/$orderNumber');

const STATUS_TONE: Record<OrderStatus, ChipTone> = {
  pending: 'warning',
  paid: 'info',
  processing: 'info',
  shipped: 'positive',
  delivered: 'positive',
  cancelled: 'neutral',
  refunded: 'negative',
};

const ACTION_LABEL: Record<OrderStatus, string> = {
  pending: 'Back to pending',
  paid: 'Mark paid',
  processing: 'Start processing',
  shipped: 'Mark shipped',
  delivered: 'Mark delivered',
  cancelled: 'Cancel order',
  refunded: 'Mark refunded',
};

const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const when = (iso: string | null) => (iso === null ? null : DATE_TIME.format(new Date(iso)));

function OrderDetail() {
  const { orderNumber } = route.useParams();

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin', 'order', orderNumber],
    queryFn: ({ signal }) => apiGet<AdminOrderDetail>(`/admin/orders/${orderNumber}`, signal),
  });

  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The fetched order is the starting point; every action replaces it with what the server returned,
  // so the panel always shows the state the API just confirmed rather than an optimistic guess.
  const current = order ?? data ?? null;

  async function act(action: () => Promise<AdminOrderDetail>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setOrder(await action());
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'That did not work.');
      // A 409 means somebody else moved this order. Re-reading is the only useful response.
      void refetch();
    } finally {
      setBusy(false);
    }
  }

  if (isError) {
    return (
      <p className="rounded-lg border border-admin-border bg-white p-6 text-bodySm text-terracotta">
        No order with that number.
      </p>
    );
  }

  if (isPending || current === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/orders"
            className="inline-flex items-center gap-1.5 text-caption text-admin-muted hover:text-green"
          >
            <Icon name="arrow-left" size={13} />
            All orders
          </Link>
          <h2 className="mt-1 flex items-center gap-3 font-mono text-[20px] text-ink">
            {current.orderNumber}
            <StatusChip tone={STATUS_TONE[current.status]}>{current.status}</StatusChip>
          </h2>
        </div>
        <p className="text-bodySm text-body-muted">Placed {when(current.createdAt)}</p>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="rounded-lg border border-terracotta/40 bg-terracotta-bg px-5 py-3 text-bodySm text-terracotta"
        >
          {error}
        </p>
      )}

      <Actions order={current} busy={busy} onAct={act} />

      <div className="grid grid-cols-[1.6fr_1fr] gap-5 tablet:grid-cols-1">
        <div className="flex flex-col gap-5">
          <Panel title="Items">
            <table className="w-full border-collapse text-left">
              <tbody>
                {current.items.map((item) => (
                  <tr key={item.sku} className="border-b border-admin-border/60 last:border-0">
                    <td className="py-3 pr-4">
                      <p className="text-bodySm font-medium text-ink">{item.name}</p>
                      <p className="font-mono text-[11px] text-admin-muted">
                        {item.weightLabel} · {item.sku}
                      </p>
                    </td>
                    <td className="py-3 pr-4 text-bodySm text-body-muted">×{item.qty}</td>
                    <td className="py-3 text-right text-bodySm text-ink">
                      {Money.fromCents(item.lineTotalCents).format()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="mt-4 flex flex-col gap-1.5 border-t border-admin-border pt-4">
              <Total label="Subtotal" cents={current.subtotalCents} />
              {current.discountCents > 0 && (
                <Total
                  label={`Discount${current.promoCode === null ? '' : ` (${current.promoCode})`}`}
                  cents={-current.discountCents}
                />
              )}
              <Total label="Shipping" cents={current.shippingCents} />
              <Total label="Tax" cents={current.taxCents} />
              <Total label="Total" cents={current.totalCents} strong />
            </dl>
          </Panel>

          {/* Keyed on the values they start from, so a change made elsewhere on this page - marking
              the order shipped fills in the tracking - remounts them with what the server returned
              rather than leaving an editor looking at the fields as they were on load. */}
          <Tracking
            key={`${current.tracking?.carrier ?? ''}|${current.tracking?.number ?? ''}`}
            order={current}
            busy={busy}
            onAct={act}
          />
          <Note key={current.adminNote ?? ''} order={current} busy={busy} onAct={act} />
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Customer">
            <p className="text-bodySm text-ink">{current.customerName ?? 'Guest checkout'}</p>
            <p className="text-bodySm text-body-muted">{current.email}</p>
            {current.customerNote !== null && (
              <p className="mt-3 rounded-md bg-admin-bg p-3 text-bodySm italic text-body-muted">
                “{current.customerNote}”
              </p>
            )}
          </Panel>

          <Panel title="Shipping to">
            <address className="text-bodySm not-italic leading-relaxed text-body-muted">
              {current.shippingAddress.firstName} {current.shippingAddress.lastName}
              <br />
              {current.shippingAddress.line1}
              {current.shippingAddress.line2 !== null && (
                <>
                  <br />
                  {current.shippingAddress.line2}
                </>
              )}
              <br />
              {current.shippingAddress.city}, {current.shippingAddress.state}{' '}
              {current.shippingAddress.zip}
            </address>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-admin-muted">
              {current.shippingMethod}
            </p>
          </Panel>

          <Panel title="Payment">
            {current.payment === null ? (
              <p className="text-bodySm text-admin-muted">Nothing captured yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5 text-bodySm">
                <p className="text-ink">
                  {current.payment.brand ?? current.payment.provider}
                  {current.payment.last4 === null ? '' : ` ···· ${current.payment.last4}`}
                </p>
                <p className="text-body-muted">
                  {Money.fromCents(current.payment.amountCents).format()} · {current.payment.status}
                </p>
                {current.payment.refundedCents > 0 && (
                  <p className="text-terracotta">
                    {Money.fromCents(current.payment.refundedCents).format()} refunded
                  </p>
                )}
                {/* Where a conversation with the provider starts. */}
                <p className="break-all font-mono text-[11px] text-admin-muted">
                  {current.payment.providerPaymentId}
                </p>
              </div>
            )}
          </Panel>

          <Panel title="Timeline">
            <ol className="flex flex-col gap-2 text-bodySm">
              {(
                [
                  ['Placed', current.createdAt],
                  ['Paid', current.paidAt],
                  ['Shipped', current.shippedAt],
                  ['Delivered', current.deliveredAt],
                  ['Cancelled', current.cancelledAt],
                  ['Refunded', current.refundedAt],
                ] as const
              )
                .filter(([, iso]) => iso !== null)
                .map(([label, iso]) => (
                  <li key={label} className="flex justify-between gap-4">
                    <span className="text-body-muted">{label}</span>
                    <span className="text-ink">{when(iso)}</span>
                  </li>
                ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}

type Act = (action: () => Promise<AdminOrderDetail>) => Promise<void>;

/**
 * The status buttons, and the tracking fields that appear when shipping is one of them.
 *
 * Asking for carrier and number in the same action as "mark shipped" is deliberate: that is the
 * moment an operator has them, and splitting it in two would send a customer a shipping notice with
 * nothing to follow.
 */
function Actions({ order, busy, onAct }: { order: AdminOrderDetail; busy: boolean; onAct: Act }) {
  const [carrier, setCarrier] = useState('');
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<OrderStatus | null>(null);

  if (order.allowedTransitions.length === 0) {
    return (
      <p className="rounded-lg border border-admin-border bg-admin-bg px-5 py-3 text-bodySm text-admin-muted">
        This order is {order.status}; there is nothing further to do to it here.
        {order.status !== 'refunded' &&
          ' A refund is recorded when the payment provider reports one.'}
      </p>
    );
  }

  function submit(status: OrderStatus) {
    void onAct(() =>
      apiPatch<AdminOrderDetail>(`/admin/orders/${order.orderNumber}/status`, {
        status,
        ...(status === 'shipped' && carrier.trim() !== '' ? { carrier: carrier.trim() } : {}),
        ...(status === 'shipped' && number.trim() !== '' ? { trackingNumber: number.trim() } : {}),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }),
    );
    setPending(null);
    setNote('');
  }

  return (
    <section className="rounded-lg border border-admin-border bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        {order.allowedTransitions.map((status) => (
          <Button
            key={status}
            size="sm"
            variant={status === 'cancelled' ? 'outline' : 'primary'}
            disabled={busy}
            onClick={() => {
              // Shipping and cancelling both want a line typed first: one needs the tracking, the
              // other needs a reason that outlives whoever pressed the button.
              if (status === 'shipped' || status === 'cancelled') setPending(status);
              else submit(status);
            }}
          >
            {ACTION_LABEL[status]}
          </Button>
        ))}
      </div>

      {pending !== null && (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-admin-border bg-admin-bg p-4">
          {pending === 'shipped' && (
            <div className="grid grid-cols-2 gap-3 mobile:grid-cols-1">
              <Field label="Carrier">
                <Input
                  value={carrier}
                  placeholder="UPS"
                  onChange={(event) => {
                    setCarrier(event.target.value);
                  }}
                />
              </Field>
              <Field label="Tracking number">
                <Input
                  value={number}
                  placeholder="1Z999AA10123456784"
                  onChange={(event) => {
                    setNumber(event.target.value);
                  }}
                />
              </Field>
            </div>
          )}

          <Field
            label={
              pending === 'cancelled' ? 'Why is this being cancelled?' : 'Internal note (optional)'
            }
          >
            <Input
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </Field>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              loading={busy}
              variant={pending === 'cancelled' ? 'outline' : 'primary'}
              onClick={() => {
                submit(pending);
              }}
            >
              {ACTION_LABEL[pending]}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPending(null);
              }}
            >
              Never mind
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Correcting a mistyped number, without shipping the order — and the notice — a second time. */
function Tracking({ order, busy, onAct }: { order: AdminOrderDetail; busy: boolean; onAct: Act }) {
  const [carrier, setCarrier] = useState(order.tracking?.carrier ?? '');
  const [number, setNumber] = useState(order.tracking?.number ?? '');

  return (
    <Panel title="Tracking">
      <div className="grid grid-cols-2 gap-3 mobile:grid-cols-1">
        <Field label="Carrier">
          <Input
            value={carrier}
            onChange={(event) => {
              setCarrier(event.target.value);
            }}
          />
        </Field>
        <Field label="Number">
          <Input
            value={number}
            onChange={(event) => {
              setNumber(event.target.value);
            }}
          />
        </Field>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        disabled={busy}
        onClick={() => {
          void onAct(() =>
            apiPut<AdminOrderDetail>(`/admin/orders/${order.orderNumber}/tracking`, {
              carrier: carrier.trim() === '' ? null : carrier.trim(),
              trackingNumber: number.trim() === '' ? null : number.trim(),
              trackingUrl: null,
            }),
          );
        }}
      >
        Save tracking
      </Button>
    </Panel>
  );
}

function Note({ order, busy, onAct }: { order: AdminOrderDetail; busy: boolean; onAct: Act }) {
  const [text, setText] = useState(order.adminNote ?? '');

  return (
    <Panel title="Internal note" note="Never shown to the customer">
      <Textarea
        rows={4}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        disabled={busy}
        onClick={() => {
          void onAct(() =>
            apiPut<AdminOrderDetail>(`/admin/orders/${order.orderNumber}/note`, {
              adminNote: text,
            }),
          );
        }}
      >
        Save note
      </Button>
    </Panel>
  );
}

function Total({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={strong ? 'text-bodySm font-medium text-ink' : 'text-bodySm text-body-muted'}>
        {label}
      </dt>
      <dd className={strong ? 'text-body font-semibold text-ink' : 'text-bodySm text-ink'}>
        {Money.fromCents(cents).format()}
      </dd>
    </div>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-admin-border bg-white p-5 shadow-card">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 className="font-serif text-[17px] text-ink">{title}</h3>
        {note !== undefined && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted">
            {note}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export default OrderDetail;
