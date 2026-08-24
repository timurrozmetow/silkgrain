import { Breadcrumb, Card, Eyebrow, Icon, Skeleton } from '@silkgrain/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { OrderLookupForm } from '../components/order/OrderLookupForm';
import { OrderSummaryCard } from '../components/order/OrderSummaryCard';
import { TrackingTimeline } from '../components/order/TrackingTimeline';
import { useOrder } from '../components/order/use-order';
import { ApiRequestError } from '../lib/api';
import { Seo } from '../lib/seo';

/**
 * Order tracking, for anyone holding a number and the email it was placed with.
 *
 * The five carrier steps the mockup draws are derived from the order's own timestamps: there is
 * no carrier integration, which `BACKLOG.md` records as a deliberate deferral along with what it
 * would add - real scan events, label purchase, rate shopping. The map is a placeholder tile
 * rather than a live position for the same reason, and the tracking number links out to the
 * carrier's own site, which is the one place that does know where the parcel is.
 */
function Track() {
  const [lookup, setLookup] = useState<{ orderNumber: string; email: string } | null>(null);
  const query = useOrder(lookup?.orderNumber ?? '', lookup?.email ?? null);

  const notFound =
    query.error instanceof ApiRequestError &&
    (query.error.status === 404 || query.error.status === 422);

  return (
    <div className="mx-auto max-w-container px-gutter py-10 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-6">
      <Seo
        title="Track your order — SilkGrain"
        description="Where your grains are, and when they arrive."
        canonicalPath="/track"
        noIndex
      />

      <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Track order' }]} />

      <div className="mt-6">
        <Eyebrow>On its way</Eyebrow>
        <h1 className="mt-3 font-serif text-[42px] leading-tight text-ink mobile:text-[30px]">
          Track your order
        </h1>
      </div>

      {query.data === undefined ? (
        <div className="mt-10">
          <OrderLookupForm
            onSubmit={setLookup}
            notFound={notFound}
            busy={query.isFetching && !notFound}
          />
          <p className="mx-auto mt-4 max-w-md text-center text-caption text-muted">
            The number is in your confirmation email, and looks like SG-2026-00001.
          </p>
        </div>
      ) : (
        <>
          {/* The dark header card: number, carrier, and where it is going. */}
          <Card variant="deep" padding="md" className="mt-8">
            <div className="grid grid-cols-3 gap-8 tablet:grid-cols-1 tablet:gap-4">
              <Stat label="Order" value={query.data.orderNumber} mono />
              <Stat
                label="Carrier"
                value={
                  query.data.tracking === null ? (
                    'Not shipped yet'
                  ) : query.data.tracking.url === null ? (
                    `${query.data.tracking.carrier} · ${query.data.tracking.number}`
                  ) : (
                    <a
                      href={query.data.tracking.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 text-gold underline underline-offset-4"
                    >
                      {query.data.tracking.carrier} · {query.data.tracking.number}
                      <Icon name="arrow-right" size={14} />
                    </a>
                  )
                }
              />
              <Stat
                label="Shipping to"
                value={`${query.data.shippingAddress.city}, ${query.data.shippingAddress.state}`}
              />
            </div>
          </Card>

          <div className="mt-8 grid grid-cols-[1fr_360px] items-start gap-8 tablet:grid-cols-1 tablet:gap-6">
            <Card padding="md">
              <TrackingTimeline order={query.data} />
            </Card>

            <div className="flex flex-col gap-6">
              {/* A placeholder tile, not a live map: no carrier integration, no position. */}
              <div className="relative flex h-[180px] items-end overflow-hidden rounded-lg border border-line bg-gradient-to-br from-sage-bg to-surface">
                <Icon
                  name="map-trifold"
                  size={56}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-green/20"
                />
                <p className="relative w-full bg-surface/80 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                  {query.data.tracking === null
                    ? 'Awaiting dispatch from Houston'
                    : 'Live position needs a carrier feed'}
                </p>
              </div>

              <OrderSummaryCard order={query.data} />

              <Link
                to="/help"
                className="inline-flex items-center justify-center gap-2 rounded-md border border-line bg-surface px-4 py-3 text-bodySm font-semibold text-green transition-colors hover:border-green mobile:min-h-11"
              >
                <Icon name="headset" size={16} />
                Need help with this order?
              </Link>
            </div>
          </div>
        </>
      )}

      {query.isFetching && query.data === undefined && !notFound && (
        <div className="mt-8">
          <Skeleton className="h-24 w-full" />
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ondeep-muted">{label}</p>
      <p className={`mt-1.5 text-ondeep ${mono ? 'font-mono text-[17px]' : 'text-bodySm'}`}>
        {value}
      </p>
    </div>
  );
}

export default Track;
