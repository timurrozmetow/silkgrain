import type { AdminDashboard, AdminMetric, AdminRevenuePoint } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Icon, Skeleton, StatusChip, type ChipTone, type IconName } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '../lib/api';

/**
 * The dashboard.
 *
 * Four KPI cards, a revenue chart, a low-stock panel and the most recent orders — the one admin
 * screen the mockup draws in full, so this follows it rather than inventing a layout.
 *
 * Every figure comes from `GET /api/admin/dashboard` and none is computed here. The chart is
 * inline SVG rather than a charting library: it is one polyline and one gradient, and the smallest
 * chart library in common use is heavier than this entire panel's JavaScript.
 */
function Dashboard() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: ({ signal }) => apiGet<AdminDashboard>('/admin/dashboard', signal),
  });

  if (isError) {
    return (
      <Panel>
        <p className="text-bodySm text-terracotta">
          The dashboard could not be loaded. Refreshing usually sorts it out.
        </p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-4 gap-5 tablet:grid-cols-2 mobile:grid-cols-1">
        <KpiCard
          label="Revenue"
          icon="currency-dollar"
          tone="green"
          metric={data?.revenueCents}
          format={(cents) => Money.fromCents(cents).format()}
          isPending={isPending}
        />
        <KpiCard
          label="Orders"
          icon="receipt"
          tone="gold"
          metric={data?.orderCount}
          format={(value) => String(value)}
          isPending={isPending}
        />
        <KpiCard
          label="Average order"
          icon="chart-line-up"
          tone="sage"
          metric={data?.averageOrderCents}
          format={(cents) => Money.fromCents(cents).format()}
          isPending={isPending}
        />
        <KpiCard
          label="New customers"
          icon="users"
          tone="terracotta"
          metric={data?.newCustomers}
          format={(value) => String(value)}
          isPending={isPending}
        />
      </div>

      <Panel>
        <PanelHead
          title="Revenue"
          note={data === undefined ? '' : `Last ${String(data.windowDays)} days`}
        />
        {data === undefined ? (
          <Skeleton className="mt-5 h-[220px] w-full" />
        ) : (
          <RevenueChart points={data.revenueSeries} />
        )}
      </Panel>

      <div className="grid grid-cols-[1fr_1.3fr] gap-6 tablet:grid-cols-1">
        <Panel>
          <PanelHead title="Low stock" note="Restock these" />
          {data === undefined ? (
            <Skeleton className="mt-5 h-[180px] w-full" />
          ) : data.lowStock.length === 0 ? (
            <p className="mt-5 text-bodySm text-admin-muted">
              Nothing is near its threshold. A rare and pleasant state.
            </p>
          ) : (
            <ul className="mt-5 flex flex-col gap-4">
              {data.lowStock.map((row) => (
                <li key={row.variantId}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="truncate text-bodySm text-ink">
                      {row.productName}{' '}
                      <span className="font-mono text-[12px] text-admin-muted">
                        {row.weightLabel}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 font-mono text-[12px] ${
                        row.stockQty === 0 ? 'text-terracotta' : 'text-gold-dark'
                      }`}
                    >
                      {row.stockQty === 0 ? 'Out of stock' : `${String(row.stockQty)} left`}
                    </span>
                  </div>
                  {/* The bar is a fraction of the variant's own threshold, which is what makes
                      "low" mean something different for saffron than for a 25 lb sack. */}
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-admin-line">
                    <div
                      className={row.stockQty === 0 ? 'h-full bg-terracotta' : 'h-full bg-gold'}
                      style={{
                        width: `${String(
                          Math.max(
                            2,
                            Math.min(
                              100,
                              row.lowStockThreshold === 0
                                ? 100
                                : Math.round((row.stockQty / row.lowStockThreshold) * 100),
                            ),
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHead title="Recent orders" note="Newest first" />
          {data === undefined ? (
            <Skeleton className="mt-5 h-[180px] w-full" />
          ) : data.recentOrders.length === 0 ? (
            <p className="mt-5 text-bodySm text-admin-muted">No orders yet.</p>
          ) : (
            // Tables scroll inside their card at a 720px minimum rather than collapsing, which is
            // the responsive handoff's rule for the admin specifically.
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-admin-table border-collapse text-left">
                <thead>
                  <tr className="border-b border-admin-border">
                    {['Order', 'Customer', 'Items', 'Total', 'Status'].map((heading) => (
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
                  {data.recentOrders.map((row) => (
                    <tr key={row.orderNumber} className="border-b border-admin-line last:border-0">
                      <td className="py-3 font-mono text-[12.5px] text-ink">{row.orderNumber}</td>
                      <td className="py-3 pr-4 text-bodySm text-body-muted">
                        <span className="block truncate">{row.customerName ?? row.email}</span>
                        {row.customerName !== null && (
                          <span className="block truncate font-mono text-[11px] text-admin-muted">
                            {row.email}
                          </span>
                        )}
                      </td>
                      <td className="py-3 font-mono text-[12.5px] text-body-muted">
                        {row.itemCount}
                      </td>
                      <td className="py-3 font-mono text-[12.5px] text-ink">
                        {Money.fromCents(row.totalCents).format()}
                      </td>
                      <td className="py-3">
                        <StatusChip tone={STATUS_TONE[row.status]}>{row.status}</StatusChip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<AdminDashboard['recentOrders'][number]['status'], ChipTone> = {
  pending: 'warning',
  paid: 'info',
  processing: 'info',
  shipped: 'info',
  delivered: 'positive',
  cancelled: 'negative',
  refunded: 'neutral',
};

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
      {children}
    </section>
  );
}

function PanelHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="font-serif text-[20px] text-ink">{title}</h2>
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-admin-muted">
        {note}
      </span>
    </div>
  );
}

const TONES = {
  green: 'bg-sage-bg text-green',
  gold: 'bg-gold-bg text-gold-dark',
  sage: 'bg-sage-bg text-green-muted',
  terracotta: 'bg-terracotta-bg text-terracotta',
} as const;

function KpiCard({
  label,
  icon,
  tone,
  metric,
  format,
  isPending,
}: {
  label: string;
  icon: IconName;
  tone: keyof typeof TONES;
  metric: AdminMetric | undefined;
  format: (value: number) => string;
  isPending: boolean;
}) {
  return (
    <div className="rounded-lg border border-admin-border bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-md ${TONES[tone]}`}>
          <Icon name={icon} size={20} />
        </span>
        {metric !== undefined && <DeltaChip basisPoints={metric.deltaBasisPoints} />}
      </div>

      <div className="mt-4">
        {isPending || metric === undefined ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="font-serif text-[28px] leading-none text-ink">{format(metric.current)}</p>
        )}
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted">
          {label}
        </p>
      </div>
    </div>
  );
}

/**
 * The delta chip. A dash when there is nothing to compare against.
 *
 * The API sends null rather than zero for an empty previous window, and this is why: a first
 * month of trading shown as "0.0%" is a number the operator would believe.
 */
function DeltaChip({ basisPoints }: { basisPoints: number | null }) {
  if (basisPoints === null) {
    return (
      <span
        className="font-mono text-[11px] text-admin-muted"
        title="No previous period to compare"
      >
        —
      </span>
    );
  }

  const up = basisPoints >= 0;
  const percent = (Math.abs(basisPoints) / 100).toFixed(1);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-2 py-1 font-mono text-[11px] ${
        up ? 'bg-sage-bg text-green-muted' : 'bg-terracotta-bg text-terracotta'
      }`}
    >
      <Icon name={up ? 'chart-line-up' : 'chart-line-down'} size={12} />
      {up ? '+' : '−'}
      {percent}%
    </span>
  );
}

/**
 * The revenue chart: one filled area, one line, no library.
 *
 * Drawn in a 0–100 × 0–100 viewBox and stretched, so it needs no measurement of its container and
 * no resize listener. A flat series is drawn along the bottom rather than through the middle -
 * dividing by a zero range would put "no sales at all" halfway up the chart.
 */
function RevenueChart({ points }: { points: AdminRevenuePoint[] }) {
  if (points.length < 2) {
    return (
      <p className="mt-5 text-bodySm text-admin-muted">Not enough days to draw a chart yet.</p>
    );
  }

  const max = Math.max(...points.map((point) => point.cents));
  const step = 100 / (points.length - 1);
  const y = (cents: number) => (max === 0 ? 100 : 100 - (cents / max) * 100);

  const line = points.map((point, index) => `${String(index * step)},${String(y(point.cents))}`);
  const area = `0,100 ${line.join(' ')} 100,100`;

  const total = points.reduce((sum, point) => sum + point.cents, 0);
  const busiest = points.reduce((best, point) => (point.cents > best.cents ? point : best));

  return (
    <div className="mt-5">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-[220px] w-full"
        role="img"
        aria-label={`Revenue over the last ${String(points.length)} days, ${Money.fromCents(
          total,
        ).format()} in total`}
      >
        <defs>
          <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0E6B4A" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0E6B4A" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#revenue-fill)" />
        <polyline
          points={line.join(' ')}
          fill="none"
          stroke="#0E6B4A"
          strokeWidth="0.9"
          // The viewBox is stretched, so a plain stroke would be thicker vertically than
          // horizontally. Non-scaling keeps it an even hairline.
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>

      <div className="mt-3 flex items-baseline justify-between font-mono text-[11px] text-admin-muted">
        <span>{points[0]?.date}</span>
        <span className="text-ink">
          {Money.fromCents(total).format()} total · best day{' '}
          {Money.fromCents(busiest.cents).format()}
        </span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export default Dashboard;
