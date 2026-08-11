import type { OrderStatus, OrderView } from '@silkgrain/contracts';
import type { ChipTone } from '@silkgrain/ui';

/**
 * How an order's status reads to the customer, in one place.
 *
 * The account history, the confirmation screen and the tracking page all show it, and three
 * copies of "paid is blue and cancelled is terracotta" is two too many.
 */
export const ORDER_CHIP: Record<OrderStatus, { tone: ChipTone; label: string }> = {
  pending: { tone: 'warning', label: 'Pending' },
  paid: { tone: 'info', label: 'Paid' },
  processing: { tone: 'info', label: 'Processing' },
  shipped: { tone: 'info', label: 'Shipped' },
  delivered: { tone: 'positive', label: 'Delivered' },
  cancelled: { tone: 'negative', label: 'Cancelled' },
  refunded: { tone: 'neutral', label: 'Refunded' },
};

export function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * The order's position along the happy path, or `null` if it left it.
 *
 * `cancelled` and `refunded` are terminal and off-path: a cancelled order has no useful place on
 * a progress timeline, and drawing it at whatever step it died on suggests it is still moving.
 */
const PROGRESS: OrderStatus[] = ['pending', 'paid', 'processing', 'shipped', 'delivered'];

export function progressRank(status: OrderStatus): number | null {
  const rank = PROGRESS.indexOf(status);
  return rank === -1 ? null : rank;
}

export interface TrackingStep {
  label: string;
  /** Null while the step is still ahead, or when it has no timestamp of its own. */
  date: string | null;
  done: boolean;
  /** The step the order is sitting on right now. */
  current: boolean;
}

/**
 * The tracking timeline, derived from the order's own timestamps.
 *
 * The mockup draws five steps: Order Placed, Packed, Shipped, Out for Delivery, Delivered. Four
 * of those exist in the data; "Out for Delivery" is a carrier scan event, and there is no carrier
 * integration (see `BACKLOG.md`, which already settled that this page derives its steps from
 * order timestamps until one lands). Inventing it would draw a step that never lights up.
 *
 * `Packed` is the one step with a state but no timestamp - the admin moves an order to
 * `processing` when it is packed, and no column records when. It shows as reached, without a date,
 * which is honest and reads fine beside the others.
 */
export function trackingSteps(order: OrderView): TrackingStep[] {
  const rank = progressRank(order.status);
  const reached = (at: number) => rank !== null && rank >= at;

  const steps: { label: string; at: number; date: string | null }[] = [
    { label: 'Order placed', at: 0, date: order.createdAt },
    { label: 'Payment received', at: 1, date: order.paidAt },
    { label: 'Packed', at: 2, date: null },
    { label: 'Shipped', at: 3, date: order.shippedAt },
    { label: 'Delivered', at: 4, date: order.deliveredAt },
  ];

  return steps.map((step) => ({
    label: step.label,
    date: step.date,
    done: reached(step.at),
    current: rank === step.at,
  }));
}
