import type { AdminPromoDetail } from '@silkgrain/contracts';
import { Icon } from '@silkgrain/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import {
  PromoForm,
  PromoSubmit,
  type PromoFormValues,
  emptyPromo,
  formToBody,
} from '../components/PromoForm';
import { ApiRequestError, apiPost } from '../lib/api';

/** Create a promo code. The form starts blank and active. */
function NewPromo() {
  const navigate = useNavigate();
  const [values, setValues] = useState<PromoFormValues>(emptyPromo);
  const [error, setError] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  function submit() {
    if (busy) return;
    const body = formToBody(values);
    if (body === null) {
      setError(['The discount amount is missing or could not be read as a number.']);
      return;
    }

    setBusy(true);
    setError(null);
    apiPost<AdminPromoDetail>('/admin/promos', { ...body, isActive: true })
      .then((created) => {
        void navigate({ to: '/promos/$id', params: { id: created.id } });
      })
      .catch((cause: unknown) => {
        setBusy(false);
        setError(messagesFrom(cause));
      });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/promos"
          className="inline-flex items-center gap-1.5 text-caption text-admin-muted hover:text-green"
        >
          <Icon name="arrow-left" size={13} />
          All codes
        </Link>
        <h2 className="mt-1 font-serif text-[24px] text-ink">New promo code</h2>
      </div>

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <PromoForm values={values} onChange={setValues} />
      </section>

      <PromoSubmit label="Create code" busy={busy} error={error} onSubmit={submit} />
    </div>
  );
}

/** Turns a 422's field details or a 409's message into lines for the banner. */
export function messagesFrom(cause: unknown): string[] {
  if (cause instanceof ApiRequestError) {
    if (Array.isArray(cause.details)) {
      const lines = cause.details
        .map((detail) =>
          typeof detail === 'object' && detail !== null && 'message' in detail
            ? String((detail as { message: unknown }).message)
            : null,
        )
        .filter((line): line is string => line !== null);
      if (lines.length > 0) return lines;
    }
    return [cause.message];
  }
  return ['Something went wrong. Please try again.'];
}

export default NewPromo;
