import type { AdminPromoDetail, PromoState } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Button, Icon, Skeleton, StatusChip, type ChipTone } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';

import {
  PromoForm,
  PromoSubmit,
  type PromoFormValues,
  formToBody,
  promoToForm,
} from '../components/PromoForm';
import { apiGet, apiPatch, apiPut } from '../lib/api';

import { messagesFrom } from './promo-new.page';
import { discountLabel } from './promos.page';

/**
 * One promo code: its fields, its kill switch, and what it has actually taken off.
 *
 * The active toggle is its own PATCH rather than a checkbox in the form, because the full-replace
 * PUT deliberately does not carry `isActive` - a stale edit form must not revert a switch somebody
 * threw while it was open. Renaming is disabled once an order has named the code, because the string
 * is a snapshot other rows point at.
 */
const route = getRouteApi('/promos/$id');

const STATE_TONE: Record<PromoState, ChipTone> = {
  live: 'positive',
  scheduled: 'info',
  exhausted: 'warning',
  expired: 'neutral',
  disabled: 'negative',
};

const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function PromoDetail() {
  const { id } = route.useParams();

  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'promo', id],
    queryFn: ({ signal }) => apiGet<AdminPromoDetail>(`/admin/promos/${String(id)}`, signal),
  });

  const [promo, setPromo] = useState<AdminPromoDetail | null>(null);
  const [values, setValues] = useState<PromoFormValues | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const current = promo ?? data ?? null;

  // Seed the editable copy the first time the code arrives.
  if (current !== null && values === null) {
    setValues(promoToForm(current));
  }

  function apply(next: AdminPromoDetail) {
    setPromo(next);
    setValues(promoToForm(next));
  }

  function save() {
    if (busy || values === null) return;
    const body = formToBody(values);
    if (body === null) {
      setError(['The discount amount is missing or could not be read as a number.']);
      return;
    }

    setBusy(true);
    setError(null);
    // PUT does not carry isActive; the toggle below owns it.
    apiPut<AdminPromoDetail>(`/admin/promos/${String(id)}`, body)
      .then(apply)
      .catch((cause: unknown) => {
        setError(messagesFrom(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function toggleActive(isActive: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    apiPatch<AdminPromoDetail>(`/admin/promos/${String(id)}/active`, { isActive })
      .then(apply)
      .catch((cause: unknown) => {
        setError(messagesFrom(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  if (isError) {
    return (
      <p className="rounded-lg border border-admin-border bg-white p-6 text-bodySm text-terracotta">
        No promo code with that id.
      </p>
    );
  }

  if (isPending || current === null || values === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/promos"
            className="inline-flex items-center gap-1.5 text-caption text-admin-muted hover:text-green"
          >
            <Icon name="arrow-left" size={13} />
            All codes
          </Link>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[22px] text-ink">
            {current.code}
            <StatusChip tone={STATE_TONE[current.state]}>{current.state}</StatusChip>
          </h2>
          <p className="mt-1 text-bodySm text-body-muted">{discountLabel(current.discount)}</p>
        </div>

        <Button
          variant={current.isActive ? 'outline' : 'primary'}
          disabled={busy}
          onClick={() => {
            toggleActive(!current.isActive);
          }}
        >
          {current.isActive ? 'Switch off' : 'Switch on'}
        </Button>
      </div>

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <PromoForm values={values} onChange={setValues} canRenameCode={current.canRenameCode} />
      </section>

      <PromoSubmit label="Save changes" busy={busy} error={error} onSubmit={save} />

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h3 className="font-serif text-[17px] text-ink">Redemptions</h3>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-admin-muted">
            {current.redemptionCount === 0
              ? 'None yet'
              : current.redemptionCount > current.redemptions.length
                ? `Latest ${String(current.redemptions.length)} of ${String(current.redemptionCount)}`
                : `${String(current.redemptionCount)} total`}
          </span>
        </div>

        {current.redemptions.length === 0 ? (
          <p className="text-bodySm text-admin-muted">This code has not been used yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <tbody>
                {current.redemptions.map((redemption) => (
                  <tr
                    key={`${redemption.orderNumber}|${redemption.createdAt}`}
                    className="border-b border-admin-border/60 last:border-0"
                  >
                    <td className="py-2.5 pr-4">
                      <Link
                        to="/orders/$orderNumber"
                        params={{ orderNumber: redemption.orderNumber }}
                        className="font-mono text-[12px] text-ink hover:text-green"
                      >
                        {redemption.orderNumber}
                      </Link>
                    </td>
                    <td className="max-w-[220px] truncate py-2.5 pr-4 text-bodySm text-body-muted">
                      {redemption.email}
                    </td>
                    <td className="py-2.5 pr-4 text-bodySm text-body-muted">
                      {DATE_TIME.format(new Date(redemption.createdAt))}
                    </td>
                    <td className="py-2.5 text-right text-bodySm text-ink">
                      {/* Zero is what a free-shipping redemption records: the waived postage is
                          not stored, and today's rate is not the rate it shipped under. */}
                      {redemption.recordedDiscountCents === 0
                        ? '—'
                        : Money.fromCents(redemption.recordedDiscountCents).format()}
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

export default PromoDetail;
