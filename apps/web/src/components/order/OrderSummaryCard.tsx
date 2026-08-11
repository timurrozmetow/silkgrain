import type { OrderView } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Card, Icon } from '@silkgrain/ui';

/**
 * What was bought, where it is going and what it cost.
 *
 * Shared by the confirmation screen and the tracking page, so the two cannot describe the same
 * order differently. Every figure comes from the order row - these are the numbers the customer
 * was charged, snapshots taken at checkout, not today's prices.
 */
export function OrderSummaryCard({ order }: { order: OrderView }) {
  const money = (cents: number) => Money.fromCents(cents).format();

  return (
    <Card padding="md" className="flex flex-col gap-6">
      <ul className="flex flex-col divide-y divide-line-soft">
        {order.items.map((item, index) => (
          <li
            key={`${item.sku}-${String(index)}`}
            className="flex items-center gap-4 py-4 first:pt-0"
          >
            {item.imageUrl === null ? (
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-line-soft bg-surface-alt text-muted">
                <Icon name="package" size={20} />
              </span>
            ) : (
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                className="h-14 w-14 shrink-0 rounded-md border border-line-soft object-cover"
              />
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-bodySm font-semibold text-ink">{item.name}</p>
              <p className="font-mono text-[12px] text-muted">
                {item.weightLabel} · ×{item.qty}
              </p>
            </div>

            <span className="font-mono text-bodySm text-green">{money(item.lineTotalCents)}</span>
          </li>
        ))}
      </ul>

      <dl className="flex flex-col gap-2 border-t border-line pt-4 text-bodySm">
        <Row label="Subtotal" value={money(order.subtotalCents)} />
        {order.discountCents > 0 && (
          <Row
            label={order.promoCode === null ? 'Discount' : `Discount · ${order.promoCode}`}
            value={`−${money(order.discountCents)}`}
            tone="green"
          />
        )}
        <Row label="Shipping" value={money(order.shippingCents)} />
        <Row label="Tax" value={money(order.taxCents)} />
        <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
          <dt className="font-medium text-ink">Total</dt>
          <dd className="font-serif text-[24px] text-green">{money(order.totalCents)}</dd>
        </div>
      </dl>

      <div className="grid grid-cols-2 gap-6 border-t border-line pt-4 text-bodySm mobile:grid-cols-1">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            Shipping to
          </p>
          <address className="mt-2 not-italic text-body-muted">
            {order.shippingAddress.firstName} {order.shippingAddress.lastName}
            <br />
            {order.shippingAddress.line1}
            {order.shippingAddress.line2 !== null && (
              <>
                <br />
                {order.shippingAddress.line2}
              </>
            )}
            <br />
            {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.zip}
          </address>
        </div>

        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Payment</p>
          <p className="mt-2 text-body-muted">
            {/* A brand and four digits is the whole of what this system ever sees of a card. */}
            {order.payment === null
              ? 'Awaiting payment'
              : order.payment.last4 === null
                ? order.payment.provider === 'stripe'
                  ? 'Card'
                  : order.payment.provider
                : `${order.payment.brand ?? 'Card'} ending ${order.payment.last4}`}
          </p>
        </div>
      </div>
    </Card>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'green' }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-body-muted">{label}</dt>
      <dd className={`font-mono ${tone === 'green' ? 'text-green' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}
