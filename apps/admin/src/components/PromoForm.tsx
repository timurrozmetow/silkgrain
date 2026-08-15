import type { AdminPromoDetail, AdminPromoDiscount } from '@silkgrain/contracts';
import { Button, Field, Input, Select } from '@silkgrain/ui';

import {
  basisPointsToPercent,
  centsToDollars,
  dollarsToCents,
  isoToLocal,
  localToIso,
  percentToBasisPoints,
  toInt,
} from '../lib/form-values';

/**
 * The promo-code field set, shared by create and edit.
 *
 * The one place worth watching is the discount. `promo_codes.value` is one column with three
 * meanings, so the form keeps the type in a select and a single amount box whose label and unit
 * follow it - percent asks for a percentage, fixed for dollars, free shipping for nothing. What the
 * form sends is the discriminated union, so the wrong unit never reaches the wire.
 *
 * On edit, `canRenameCode` disables the code field: once an order has named a code the string is a
 * snapshot other rows point at, and renaming it would reattribute history.
 */

type DiscountType = AdminPromoDiscount['type'];

export interface PromoFormValues {
  code: string;
  description: string;
  type: DiscountType;
  amount: string;
  cap: string;
  minOrder: string;
  usageLimit: string;
  usageLimitPerCustomer: string;
  startsAt: string;
  endsAt: string;
}

export function emptyPromo(): PromoFormValues {
  return {
    code: '',
    description: '',
    type: 'percent',
    amount: '',
    cap: '',
    minOrder: '',
    usageLimit: '',
    usageLimitPerCustomer: '',
    startsAt: '',
    endsAt: '',
  };
}

export function promoToForm(detail: AdminPromoDetail): PromoFormValues {
  const { discount } = detail;
  return {
    code: detail.code,
    description: detail.description ?? '',
    type: discount.type,
    amount:
      discount.type === 'percent'
        ? basisPointsToPercent(discount.basisPoints)
        : discount.type === 'fixed'
          ? centsToDollars(discount.amountCents)
          : '',
    cap: discount.type === 'percent' ? centsToDollars(discount.maxDiscountCents) : '',
    minOrder: centsToDollars(detail.minOrderCents),
    usageLimit: detail.usageLimit === null ? '' : String(detail.usageLimit),
    usageLimitPerCustomer:
      detail.usageLimitPerCustomer === null ? '' : String(detail.usageLimitPerCustomer),
    startsAt: isoToLocal(detail.startsAt),
    endsAt: isoToLocal(detail.endsAt),
  };
}

/** The body the API expects, minus `isActive` which the two callers supply. Null if a field will not parse. */
export function formToBody(values: PromoFormValues): Record<string, unknown> | null {
  let discount: AdminPromoDiscount;
  if (values.type === 'percent') {
    const basisPoints = percentToBasisPoints(values.amount);
    if (basisPoints === null || basisPoints < 1) return null;
    discount = {
      type: 'percent',
      basisPoints,
      maxDiscountCents: values.cap.trim() === '' ? null : dollarsToCents(values.cap),
    };
  } else if (values.type === 'fixed') {
    const amountCents = dollarsToCents(values.amount);
    if (amountCents === null || amountCents < 1) return null;
    discount = { type: 'fixed', amountCents };
  } else {
    discount = { type: 'free_shipping' };
  }

  return {
    code: values.code.trim(),
    description: values.description.trim() === '' ? null : values.description.trim(),
    discount,
    minOrderCents: values.minOrder.trim() === '' ? 0 : (dollarsToCents(values.minOrder) ?? 0),
    usageLimit: values.usageLimit.trim() === '' ? null : toInt(values.usageLimit),
    usageLimitPerCustomer:
      values.usageLimitPerCustomer.trim() === '' ? null : toInt(values.usageLimitPerCustomer),
    startsAt: localToIso(values.startsAt),
    endsAt: localToIso(values.endsAt),
  };
}

const TYPE_OPTIONS = [
  { value: 'percent', label: 'Percentage off' },
  { value: 'fixed', label: 'A fixed amount off' },
  { value: 'free_shipping', label: 'Free shipping' },
];

export function PromoForm({
  values,
  onChange,
  canRenameCode = true,
}: {
  values: PromoFormValues;
  onChange: (next: PromoFormValues) => void;
  canRenameCode?: boolean;
}) {
  const set = (patch: Partial<PromoFormValues>) => {
    onChange({ ...values, ...patch });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-5 mobile:grid-cols-1">
        <Field
          label="Code"
          required
          hint={
            canRenameCode
              ? 'Upper-cased; letters, digits and hyphens'
              : 'An order has used this code, so its name is fixed'
          }
        >
          <Input
            value={values.code}
            disabled={!canRenameCode}
            onChange={(event) => {
              set({ code: event.target.value.toUpperCase() });
            }}
          />
        </Field>

        <Field label="Description" hint="Shown to nobody but the back office">
          <Input
            value={values.description}
            onChange={(event) => {
              set({ description: event.target.value });
            }}
          />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-5 tablet:grid-cols-1">
        <Field label="Discount" required>
          <Select
            value={values.type}
            options={TYPE_OPTIONS}
            onChange={(event) => {
              // Switching type clears the amount and the cap: they mean different things now, and
              // carrying a percentage into a dollar box is how the wrong figure gets saved.
              set({ type: event.target.value as DiscountType, amount: '', cap: '' });
            }}
          />
        </Field>

        {values.type !== 'free_shipping' && (
          <Field label={values.type === 'percent' ? 'Percent (%)' : 'Amount ($)'} required>
            <Input
              value={values.amount}
              inputMode="decimal"
              placeholder={values.type === 'percent' ? '10' : '5.00'}
              onChange={(event) => {
                set({ amount: event.target.value });
              }}
            />
          </Field>
        )}

        {values.type === 'percent' && (
          <Field label="Cap ($)" hint="Most it can take off; blank for uncapped">
            <Input
              value={values.cap}
              inputMode="decimal"
              onChange={(event) => {
                set({ cap: event.target.value });
              }}
            />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-3 gap-5 tablet:grid-cols-1">
        <Field label="Minimum order ($)" hint="Blank for none">
          <Input
            value={values.minOrder}
            inputMode="decimal"
            onChange={(event) => {
              set({ minOrder: event.target.value });
            }}
          />
        </Field>

        <Field label="Total uses" hint="Blank for unlimited">
          <Input
            value={values.usageLimit}
            inputMode="numeric"
            onChange={(event) => {
              set({ usageLimit: event.target.value });
            }}
          />
        </Field>

        <Field label="Uses per customer" hint="Blank for unlimited">
          <Input
            value={values.usageLimitPerCustomer}
            inputMode="numeric"
            onChange={(event) => {
              set({ usageLimitPerCustomer: event.target.value });
            }}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-5 mobile:grid-cols-1">
        <Field label="Starts" hint="Blank to start immediately">
          <Input
            type="datetime-local"
            value={values.startsAt}
            onChange={(event) => {
              set({ startsAt: event.target.value });
            }}
          />
        </Field>

        <Field label="Ends" hint="Blank to run indefinitely">
          <Input
            type="datetime-local"
            value={values.endsAt}
            onChange={(event) => {
              set({ endsAt: event.target.value });
            }}
          />
        </Field>
      </div>
    </div>
  );
}

/** A create/edit save button and its error banner, so both pages surface the API the same way. */
export function PromoSubmit({
  label,
  busy,
  error,
  onSubmit,
}: {
  label: string;
  busy: boolean;
  error: string[] | null;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {error !== null && (
        <div
          role="alert"
          className="rounded-lg border border-terracotta/40 bg-terracotta-bg px-5 py-4 text-bodySm text-terracotta"
        >
          <ul className="list-disc pl-5">
            {error.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <Button loading={busy} iconLeft="check" className="self-start" onClick={onSubmit}>
        {label}
      </Button>
    </div>
  );
}
