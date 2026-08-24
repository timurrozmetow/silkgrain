import type { OrderView } from '@silkgrain/contracts';
import { Icon, StatusChip } from '@silkgrain/ui';

import { ORDER_CHIP, formatOrderDate, progressRank, trackingSteps } from '../../lib/order-status';

/**
 * The shipment progress the mockup draws, with the steps the data can actually support.
 *
 * A cancelled or refunded order gets a statement instead of a timeline: it is not moving, and
 * drawing it stalled at whatever step it died on says the opposite.
 */
export function TrackingTimeline({ order }: { order: OrderView }) {
  const chip = ORDER_CHIP[order.status];

  if (progressRank(order.status) === null) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-6">
        <Icon name="info" size={20} className="mt-0.5 shrink-0 text-muted" />
        <div>
          <p className="font-medium text-ink">
            This order was {order.status === 'cancelled' ? 'cancelled' : 'refunded'}.
          </p>
          <p className="mt-1 text-bodySm text-muted">
            {order.status === 'cancelled'
              ? 'Nothing shipped and nothing was charged.'
              : `The payment was returned${
                  order.refundedAt === null ? '' : ` on ${formatOrderDate(order.refundedAt)}`
                }.`}{' '}
            Ask us anything through the help page.
          </p>
        </div>
      </div>
    );
  }

  const steps = trackingSteps(order);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-serif text-[24px] text-ink">Shipment progress</h2>
        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
      </div>

      <ol className="mt-6">
        {steps.map((step, index) => (
          <li key={step.label} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border ${
                  step.done
                    ? 'border-transparent bg-green text-white'
                    : 'border-line bg-surface text-muted-soft'
                }`}
              >
                <Icon name={step.done ? 'check' : 'circle'} size={step.done ? 16 : 10} />
              </span>
              {index < steps.length - 1 && (
                <span
                  aria-hidden
                  className={`w-px flex-1 ${steps[index + 1]?.done ? 'bg-green' : 'bg-line'}`}
                />
              )}
            </div>

            <div className={index === steps.length - 1 ? 'pb-0 pt-1.5' : 'pb-7 pt-1.5'}>
              <p
                className={`text-bodySm ${
                  step.current ? 'font-semibold text-green' : step.done ? 'text-ink' : 'text-muted'
                }`}
              >
                {step.label}
              </p>
              <p className="mt-0.5 font-mono text-[12px] text-muted">
                {step.date === null
                  ? step.done
                    ? // "Packed" is a state the admin sets with no column recording when.
                      'Done'
                    : 'Pending'
                  : formatOrderDate(step.date)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
