import type { AdminSettingRow, AdminSettings, AdminShippingRate } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Button, Checkbox, Field, Input, Skeleton, StatusChip } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiRequestError, apiGet, apiPut } from '../lib/api';
import { centsToDollars, dollarsToCents, toInt } from '../lib/form-values';

/**
 * Settings and shipping rates, on one screen.
 *
 * One screen and one read, which is decision D-22 rather than a layout preference: the announcement
 * copy sits directly above the rate rows, and the line telling an operator what free shipping
 * actually costs them comes from the same payload as the rate it quotes. There is exactly one
 * editable free-shipping figure in this panel and it is `free above` inside the Standard row.
 *
 * A key the registry has never heard of is shown and not editable; a key whose stored value is the
 * wrong shape is shown as broken with an empty control, so it can be repaired here rather than only
 * in MySQL.
 */

const GROUP_LABELS: Record<string, string> = {
  commerce: 'Commerce',
  content: 'Storefront copy',
  general: 'Store details',
  operations: 'Operations',
};

function Settings() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: ({ signal }) => apiGet<AdminSettings>('/admin/settings', signal),
  });

  const [saved, setSaved] = useState<AdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = saved ?? data ?? null;

  async function save(action: () => Promise<AdminSettings>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSaved(await action());
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.status === 403
            ? 'Your role cannot change settings.'
            : cause.message
          : 'That did not save.',
      );
      void refetch();
    } finally {
      setBusy(false);
    }
  }

  if (isError) {
    return (
      <p className="rounded-lg border border-admin-border bg-white p-6 text-bodySm text-terracotta">
        The settings could not be loaded.
      </p>
    );
  }

  if (isPending || current === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const groups = [...new Set(current.values.map((row) => row.group))];
  const threshold = current.shippingRates
    .filter((rate) => rate.isActive && rate.freeAboveCents !== null && rate.freeAboveCents > 0)
    .map((rate) => rate.freeAboveCents ?? 0)
    .sort((left, right) => left - right)[0];

  return (
    <div className="flex flex-col gap-5">
      {error !== null && (
        <p
          role="alert"
          className="rounded-lg border border-terracotta/40 bg-terracotta-bg px-5 py-3 text-bodySm text-terracotta"
        >
          {error}
        </p>
      )}

      {groups.map((group) => (
        <SettingsGroup
          key={group}
          // Keyed on the values it starts from, so a save elsewhere on the page remounts it with
          // what the server returned rather than leaving stale text in the inputs.
          group={group}
          rows={current.values.filter((row) => row.group === group)}
          busy={busy}
          onSave={save}
        />
      ))}

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <div className="mb-1 flex items-baseline justify-between gap-4">
          <h3 className="font-serif text-[18px] text-ink">Shipping</h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted">
            Edited and retired, never deleted
          </span>
        </div>
        <p className="mb-4 text-bodySm text-body-muted">
          {/* The one sentence that answers D-22 on the screen itself. */}
          {threshold === undefined
            ? 'No active method offers free shipping, so the storefront promises none.'
            : `The checkout gives free shipping from ${Money.fromCents(threshold).format()}, and the storefront quotes that figure. It comes from the “free above” box below — there is nowhere else to set it.`}
        </p>

        <div className="flex flex-col gap-4">
          {current.shippingRates.map((rate) => (
            <RateRow
              key={`${String(rate.id)}|${rate.updatedAt}`}
              rate={rate}
              busy={busy}
              onSave={save}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingsGroup({
  group,
  rows,
  busy,
  onSave,
}: {
  group: string;
  rows: AdminSettingRow[];
  busy: boolean;
  onSave: (action: () => Promise<AdminSettings>) => Promise<void>;
}) {
  // A predicate rather than a plain filter, so the narrowing survives into `row.value.value`.
  type EditableRow = AdminSettingRow & {
    value: Exclude<AdminSettingRow['value'], { kind: 'unregistered' }>;
  };
  const editable = rows.filter((row): row is EditableRow => row.value.kind !== 'unregistered');
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      editable.map((row) => [
        row.key,
        row.value.kind === 'malformed' ? '' : String(row.value.value),
      ]),
    ),
  );

  const dirty = editable.some((row) => {
    const original = row.value.kind === 'malformed' ? '' : String(row.value.value);
    return (draft[row.key] ?? '') !== original;
  });

  return (
    <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
      <h3 className="mb-4 font-serif text-[18px] text-ink">{GROUP_LABELS[group] ?? group}</h3>

      <div className="flex flex-col gap-4">
        {rows.map((row) => (
          <div key={row.key}>
            {row.value.kind === 'unregistered' ? (
              <div className="rounded-md border border-admin-border bg-admin-bg p-3">
                <p className="flex flex-wrap items-center gap-2 text-bodySm text-ink">
                  {row.label}
                  <StatusChip tone="neutral">No editor</StatusChip>
                </p>
                <p className="mt-1 font-mono text-[11px] text-admin-muted">
                  {row.key} = {row.value.json}
                </p>
                <p className="mt-1 text-caption text-admin-muted">
                  Nothing in the code reads this key, so the panel will not pretend to set it.
                </p>
              </div>
            ) : (
              <Field
                label={row.label}
                hint={
                  row.value.kind === 'malformed'
                    ? `Stored value is not a ${row.value.expected}: ${row.value.json}`
                    : (row.description ?? undefined)
                }
              >
                <Input
                  value={draft[row.key] ?? ''}
                  inputMode={row.value.kind === 'basisPoints' ? 'numeric' : 'text'}
                  onChange={(event) => {
                    setDraft((previous) => ({ ...previous, [row.key]: event.target.value }));
                  }}
                />
              </Field>
            )}
          </div>
        ))}
      </div>

      {editable.length > 0 && (
        <Button
          size="sm"
          className="mt-4"
          disabled={busy || !dirty}
          onClick={() => {
            const body: Record<string, string | number> = {};
            for (const row of editable) {
              const original = row.value.kind === 'malformed' ? '' : String(row.value.value);
              const next = draft[row.key] ?? '';
              if (next === original) continue;
              // Basis points go as an integer, or the strict schema refuses the string.
              body[row.key] = row.value.kind === 'basisPoints' ? (toInt(next) ?? next) : next;
            }
            void onSave(() => apiPut<AdminSettings>('/admin/settings', body));
          }}
        >
          Save {GROUP_LABELS[group]?.toLowerCase() ?? group}
        </Button>
      )}
    </section>
  );
}

function RateRow({
  rate,
  busy,
  onSave,
}: {
  rate: AdminShippingRate;
  busy: boolean;
  onSave: (action: () => Promise<AdminSettings>) => Promise<void>;
}) {
  const [name, setName] = useState(rate.name);
  const [description, setDescription] = useState(rate.description ?? '');
  const [price, setPrice] = useState(centsToDollars(rate.priceCents));
  const [freeAbove, setFreeAbove] = useState(centsToDollars(rate.freeAboveCents));
  const [daysMin, setDaysMin] = useState(String(rate.estimatedDaysMin));
  const [daysMax, setDaysMax] = useState(String(rate.estimatedDaysMax));
  const [isActive, setIsActive] = useState(rate.isActive);

  return (
    <div className="rounded-lg border border-admin-border bg-admin-bg p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-admin-muted">
          {rate.code}
        </span>
        {!rate.isActive && <StatusChip tone="neutral">Retired</StatusChip>}
      </div>

      <div className="grid grid-cols-4 gap-3 tablet:grid-cols-2 mobile:grid-cols-1">
        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field label="Price ($)">
          <Input
            value={price}
            inputMode="decimal"
            onChange={(event) => {
              setPrice(event.target.value);
            }}
          />
        </Field>
        <Field label="Free above ($)" hint="Blank for never">
          <Input
            value={freeAbove}
            inputMode="decimal"
            onChange={(event) => {
              setFreeAbove(event.target.value);
            }}
          />
        </Field>
        <Field label="Description">
          <Input
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </Field>
        <Field label="Days, fastest">
          <Input
            value={daysMin}
            inputMode="numeric"
            onChange={(event) => {
              setDaysMin(event.target.value);
            }}
          />
        </Field>
        <Field label="Days, slowest">
          <Input
            value={daysMax}
            inputMode="numeric"
            onChange={(event) => {
              setDaysMax(event.target.value);
            }}
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Checkbox
          label="Offered at checkout"
          checked={isActive}
          onChange={(event) => {
            setIsActive(event.target.checked);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            void onSave(() =>
              apiPut<AdminSettings>(`/admin/shipping-rates/${String(rate.id)}`, {
                name: name.trim(),
                description: description.trim() === '' ? null : description.trim(),
                priceCents: dollarsToCents(price) ?? rate.priceCents,
                freeAboveCents: freeAbove.trim() === '' ? null : dollarsToCents(freeAbove),
                estimatedDaysMin: toInt(daysMin) ?? rate.estimatedDaysMin,
                estimatedDaysMax: toInt(daysMax) ?? rate.estimatedDaysMax,
                isActive,
                position: rate.position,
              }),
            );
          }}
        >
          Save {rate.code}
        </Button>
      </div>
    </div>
  );
}

export default Settings;
