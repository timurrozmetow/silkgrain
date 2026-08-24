import type {
  AdminPriceOperation,
  AdminPricePreview,
  AdminPricePreviewRow,
  CategoryListResponse,
  ProductStatus,
} from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Button, Checkbox, Field, Input, Select, StatusChip } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiRequestError, apiGet, apiPost } from '../lib/api';

/**
 * Bulk price operations.
 *
 * Two steps, and the screen enforces the order: nothing can be applied that has not been previewed,
 * and any change to the scope or the operation clears a stale preview - the apply sends back exactly
 * the rows the preview showed, as a precondition the server checks against its own locked rows.
 *
 * The preview is the safety. It shows every affected row, marks the ones that cannot take the change
 * and why, and flags the ones that would sell under cost, before a single price moves.
 */

type OperationKind = AdminPriceOperation['kind'];

const KIND_OPTIONS = [
  { value: 'adjust_percent', label: 'Change by a percentage' },
  { value: 'adjust_cents', label: 'Change by a fixed amount' },
  { value: 'start_sale', label: 'Start a sale' },
  { value: 'end_sale', label: 'End a sale' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active products' },
  { value: 'draft', label: 'Draft products' },
  { value: 'archived', label: 'Archived products' },
  { value: 'all', label: 'Every status' },
];

const BLOCKER_LABEL: Record<string, string> = {
  price_not_positive: 'Would fall to zero',
  compare_at_not_above: 'Breaks the “was” price',
  already_on_sale: 'Already on sale',
};

function Pricing() {
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => apiGet<CategoryListResponse>('/categories', signal),
  });

  // Scope.
  const [status, setStatus] = useState<ProductStatus | 'all'>('active');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [includeInactiveVariants, setIncludeInactiveVariants] = useState(false);

  // Operation.
  const [kind, setKind] = useState<OperationKind>('adjust_percent');
  const [percent, setPercent] = useState('');
  const [cents, setCents] = useState('');
  const [salePercent, setSalePercent] = useState('');

  const [preview, setPreview] = useState<AdminPricePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allowBelowCost, setAllowBelowCost] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);

  // Any edit invalidates a preview: the apply must never send rows an operator has not just seen.
  const invalidate = () => {
    setPreview(null);
    setApplied(null);
  };

  function buildOperation(): AdminPriceOperation | null {
    switch (kind) {
      case 'adjust_percent': {
        const value = Number(percent);
        if (!Number.isFinite(value) || value === 0) return null;
        return { kind, deltaBasisPoints: Math.round(value * 100) };
      }
      case 'adjust_cents': {
        const value = Number(cents);
        if (!Number.isFinite(value) || value === 0) return null;
        return { kind, deltaCents: Math.round(value * 100) };
      }
      case 'start_sale': {
        const value = Number(salePercent);
        if (!Number.isFinite(value) || value <= 0) return null;
        return { kind, discountBasisPoints: Math.round(value * 100) };
      }
      case 'end_sale':
        return { kind };
    }
  }

  function scope() {
    return {
      status,
      includeInactiveVariants,
      ...(category === '' ? {} : { category }),
      ...(q.trim() === '' ? {} : { q: q.trim() }),
    };
  }

  async function runPreview() {
    const operation = buildOperation();
    if (operation === null) {
      setError('Enter a non-zero amount for the operation.');
      return;
    }
    setBusy(true);
    setError(null);
    setApplied(null);
    try {
      setPreview(
        await apiPost<AdminPricePreview>('/admin/pricing/preview', { scope: scope(), operation }),
      );
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'The preview failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runApply() {
    if (preview === null) return;
    const operation = buildOperation();
    if (operation === null) return;

    const rows = preview.rows
      .filter((row) => row.verdict === 'change')
      .map((row) => ({
        variantId: row.variantId,
        seenPriceCents: row.priceCents,
        seenCompareAtPriceCents: row.compareAtPriceCents,
      }));
    if (rows.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ changed: number }>('/admin/pricing/apply', {
        operation,
        rows,
        allowBelowCost,
      });
      setApplied(result.changed);
      setPreview(null);
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.code === 'PRICE_BELOW_COST'
            ? 'Some rows would sell under cost. Tick “allow below cost” to proceed.'
            : cause.code === 'PRICE_ROW_BLOCKED'
              ? 'A price changed since the preview. Re-run it.'
              : cause.message
          : 'The change could not be applied.',
      );
      // A drift or a below-cost stop means the preview is stale; make the operator re-run it.
      if (cause instanceof ApiRequestError && cause.status === 409) setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const changeCount = preview?.counts.change ?? 0;
  const belowCostCount = preview?.counts.belowCost ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <h2 className="mb-4 font-serif text-[20px] text-ink">What to change</h2>

        <div className="grid grid-cols-2 gap-5 mobile:grid-cols-1">
          <Field label="Products" hint="Which products the change reaches">
            <Select
              value={status}
              options={STATUS_OPTIONS}
              onChange={(event) => {
                setStatus(event.target.value as ProductStatus | 'all');
                invalidate();
              }}
            />
          </Field>

          <Field label="Category" hint="Blank for the whole catalogue">
            <Select
              value={category}
              options={[
                { value: '', label: 'Every category' },
                ...(categories?.items ?? []).map((node) => ({
                  value: node.slug,
                  label: node.name,
                })),
              ]}
              onChange={(event) => {
                setCategory(event.target.value);
                invalidate();
              }}
            />
          </Field>

          <Field label="Name or SKU contains" className="col-span-2 mobile:col-span-1">
            <Input
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                invalidate();
              }}
            />
          </Field>
        </div>

        <div className="mt-3">
          <Checkbox
            label="Include inactive variants"
            checked={includeInactiveVariants}
            onChange={(event) => {
              setIncludeInactiveVariants(event.target.checked);
              invalidate();
            }}
          />
        </div>
      </section>

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <h2 className="mb-4 font-serif text-[20px] text-ink">The operation</h2>

        <div className="grid grid-cols-2 gap-5 mobile:grid-cols-1">
          <Field label="Do this">
            <Select
              value={kind}
              options={KIND_OPTIONS}
              onChange={(event) => {
                setKind(event.target.value as OperationKind);
                invalidate();
              }}
            />
          </Field>

          {kind === 'adjust_percent' && (
            <Field label="By percent (%)" hint="Negative to cut; e.g. -10 or 5">
              <Input
                value={percent}
                inputMode="decimal"
                onChange={(event) => {
                  setPercent(event.target.value);
                  invalidate();
                }}
              />
            </Field>
          )}

          {kind === 'adjust_cents' && (
            <Field label="By amount ($)" hint="Negative to cut; e.g. -1.50 or 0.50">
              <Input
                value={cents}
                inputMode="decimal"
                onChange={(event) => {
                  setCents(event.target.value);
                  invalidate();
                }}
              />
            </Field>
          )}

          {kind === 'start_sale' && (
            <Field label="Discount (%)" hint="How much off the list price">
              <Input
                value={salePercent}
                inputMode="decimal"
                onChange={(event) => {
                  setSalePercent(event.target.value);
                  invalidate();
                }}
              />
            </Field>
          )}
        </div>

        {kind === 'end_sale' && (
          <p className="mt-3 text-bodySm text-body-muted">
            Restores each variant to the “was” price its sale is measured against.
          </p>
        )}

        <Button
          className="mt-5"
          loading={busy && preview === null}
          onClick={() => void runPreview()}
        >
          Preview the change
        </Button>
      </section>

      {error !== null && (
        <p
          role="alert"
          className="rounded-lg border border-terracotta/40 bg-terracotta-bg px-5 py-3 text-bodySm text-terracotta"
        >
          {error}
        </p>
      )}

      {applied !== null && (
        <p className="rounded-lg border border-green/40 bg-sage-bg px-5 py-3 text-bodySm text-green">
          {applied === 0
            ? 'Nothing needed changing.'
            : `Updated ${String(applied)} variant${applied === 1 ? '' : 's'}.`}
        </p>
      )}

      {preview !== null && (
        <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="font-serif text-[20px] text-ink">Preview</h2>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-admin-muted">
              {preview.counts.change} changing · {preview.counts.unchanged} unchanged ·{' '}
              {preview.counts.blocked} blocked
            </p>
          </div>

          {changeCount === 0 ? (
            <p className="text-bodySm text-admin-muted">
              Nothing in that scope would change. Widen it, or adjust the operation.
            </p>
          ) : (
            <>
              {belowCostCount > 0 && (
                <div className="mb-4 rounded-md border border-gold/50 bg-gold/10 p-3">
                  <Checkbox
                    label={`${String(belowCostCount)} variant${belowCostCount === 1 ? '' : 's'} would sell under cost — allow it`}
                    checked={allowBelowCost}
                    onChange={(event) => {
                      setAllowBelowCost(event.target.checked);
                    }}
                  />
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-admin-table border-collapse text-left">
                  <thead>
                    <tr className="border-b border-admin-border">
                      {['Variant', 'Now', 'New', 'Margin', ''].map((heading) => (
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
                    {preview.rows.map((row) => (
                      <PreviewRow key={row.variantId} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-4">
                <Button variant="primary" loading={busy} onClick={() => void runApply()}>
                  Apply to {changeCount} variant{changeCount === 1 ? '' : 's'}
                </Button>
                <p className="text-caption text-admin-muted">
                  Takes effect on the next cart. Orders already placed are untouched.
                </p>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function PreviewRow({ row }: { row: AdminPricePreviewRow }) {
  const margin =
    row.newMarginBasisPoints === null ? '—' : `${(row.newMarginBasisPoints / 100).toFixed(1)}%`;

  return (
    <tr
      className={`border-b border-admin-border/60 last:border-0 ${
        row.verdict === 'blocked' ? 'opacity-55' : ''
      }`}
    >
      <td className="py-2.5 pr-4">
        <p className="text-bodySm text-ink">{row.productName}</p>
        <p className="font-mono text-[11px] text-admin-muted">
          {row.sku} · {row.weightLabel}
        </p>
      </td>
      <td className="py-2.5 pr-4 text-bodySm text-body-muted">
        {Money.fromCents(row.priceCents).format()}
      </td>
      <td className="py-2.5 pr-4 text-bodySm font-medium text-ink">
        {row.verdict === 'change' ? Money.fromCents(row.newPriceCents).format() : '—'}
        {row.verdict === 'change' && row.newCompareAtPriceCents !== null && (
          <span className="ml-1.5 text-caption text-admin-muted line-through">
            {Money.fromCents(row.newCompareAtPriceCents).format()}
          </span>
        )}
      </td>
      <td className="py-2.5 pr-4 text-bodySm text-body-muted">
        <span className={row.belowCost ? 'font-medium text-terracotta' : ''}>{margin}</span>
      </td>
      <td className="py-2.5">
        {row.verdict === 'blocked' && row.blockedBy !== null ? (
          <StatusChip tone="negative">{BLOCKER_LABEL[row.blockedBy] ?? row.blockedBy}</StatusChip>
        ) : row.verdict === 'unchanged' ? (
          <span className="text-caption text-admin-muted">no change</span>
        ) : row.belowCost ? (
          <StatusChip tone="warning">below cost</StatusChip>
        ) : null}
      </td>
    </tr>
  );
}

export default Pricing;
