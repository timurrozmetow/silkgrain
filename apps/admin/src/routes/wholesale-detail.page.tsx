import type { AdminUserOption, AdminWholesaleDetail, WholesaleStatus } from '@silkgrain/contracts';
import { WHOLESALE_STATUS } from '@silkgrain/contracts/constants';
import {
  Button,
  Field,
  Icon,
  Select,
  Skeleton,
  StatusChip,
  Textarea,
  type ChipTone,
} from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';

import { ApiRequestError, apiGet, apiPatch, apiPost } from '../lib/api';

import { BUSINESS_LABEL, VOLUME_LABEL } from './wholesale.page';

/**
 * One enquiry: who wrote in, what they want, who owns it, and what has been said so far.
 *
 * Status and owner are one row of controls because they change together - taking an enquiry and
 * marking it contacted is one action to the person doing it. The thread below is append-only: it is
 * a record of a conversation, not a document being drafted, and a note that could be edited later
 * is a note nobody can rely on.
 */
const route = getRouteApi('/wholesale/$id');

const STATUS_TONE: Record<WholesaleStatus, ChipTone> = {
  new: 'info',
  contacted: 'warning',
  quoted: 'warning',
  converted: 'positive',
  declined: 'neutral',
};

const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function WholesaleDetail() {
  const { id } = route.useParams();

  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'wholesale', id],
    queryFn: ({ signal }) =>
      apiGet<AdminWholesaleDetail>(`/admin/wholesale/requests/${String(id)}`, signal),
  });

  const { data: team } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: ({ signal }) => apiGet<AdminUserOption[]>('/admin/users', signal),
  });

  const [enquiry, setEnquiry] = useState<AdminWholesaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');

  const current = enquiry ?? data ?? null;

  async function act(action: () => Promise<AdminWholesaleDetail>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setEnquiry(await action());
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (isError) {
    return (
      <p className="rounded-lg border border-admin-border bg-white p-6 text-bodySm text-terracotta">
        No enquiry with that id.
      </p>
    );
  }

  if (isPending || current === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const triage = (patch: { status?: WholesaleStatus; assignedToId?: number | null }) => {
    void act(() =>
      apiPatch<AdminWholesaleDetail>(`/admin/wholesale/requests/${String(id)}`, patch),
    );
  };

  const address = [
    current.addressLine1,
    current.addressLine2,
    [current.city, current.state, current.zip].filter(Boolean).join(' ').trim(),
  ].filter((line): line is string => line !== null && line !== '');

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          to="/wholesale"
          className="inline-flex items-center gap-1.5 text-caption text-admin-muted hover:text-green"
        >
          <Icon name="arrow-left" size={13} />
          All enquiries
        </Link>
        <h2 className="mt-1 flex flex-wrap items-center gap-3 font-serif text-[24px] text-ink">
          {current.businessName}
          <StatusChip tone={STATUS_TONE[current.status]}>{current.status}</StatusChip>
        </h2>
        <p className="mt-1 text-bodySm text-body-muted">
          {BUSINESS_LABEL[current.businessType]} · received{' '}
          {DATE_TIME.format(new Date(current.createdAt))}
        </p>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="rounded-lg border border-terracotta/40 bg-terracotta-bg px-5 py-3 text-bodySm text-terracotta"
        >
          {error}
        </p>
      )}

      <section className="flex flex-wrap items-end gap-4 rounded-lg border border-admin-border bg-white p-5 shadow-card">
        <Field label="Status" className="min-w-[180px]">
          <Select
            value={current.status}
            options={WHOLESALE_STATUS.map((status) => ({ value: status, label: status }))}
            disabled={busy}
            onChange={(event) => {
              triage({ status: event.target.value as WholesaleStatus });
            }}
          />
        </Field>

        <Field label="Owner" className="min-w-[200px]">
          <Select
            value={current.assignedToId === null ? '' : String(current.assignedToId)}
            options={[
              { value: '', label: 'Nobody' },
              ...(team ?? []).map((user) => ({ value: String(user.id), label: user.name })),
            ]}
            disabled={busy}
            onChange={(event) => {
              // The empty option hands it back to the pool, which is a null rather than an absence.
              triage({
                assignedToId: event.target.value === '' ? null : Number(event.target.value),
              });
            }}
          />
        </Field>
      </section>

      <div className="grid grid-cols-[1.4fr_1fr] gap-5 tablet:grid-cols-1">
        <Panel title="Conversation" note="Append-only">
          {current.thread.length === 0 ? (
            <p className="text-bodySm text-admin-muted">
              Nothing has been recorded yet. The first note is usually what happened on the phone.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {current.thread.map((note) => (
                <li key={note.id} className="rounded-md border border-admin-border bg-admin-bg p-3">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-caption font-semibold text-ink">{note.authorName}</span>
                    <span className="font-mono text-[10px] text-admin-muted">
                      {DATE_TIME.format(new Date(note.createdAt))}
                    </span>
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-bodySm text-body-muted">
                    {note.body}
                  </p>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-4 border-t border-admin-border pt-4">
            <Field label="Add a note">
              <Textarea
                rows={3}
                value={draft}
                placeholder="What happened?"
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
              />
            </Field>
            <Button
              size="sm"
              className="mt-3"
              disabled={busy || draft.trim() === ''}
              onClick={() => {
                void act(() =>
                  apiPost<AdminWholesaleDetail>(`/admin/wholesale/requests/${String(id)}/notes`, {
                    body: draft.trim(),
                  }).then((updated) => {
                    setDraft('');
                    return updated;
                  }),
                );
              }}
            >
              Add note
            </Button>
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Contact">
            <p className="text-bodySm text-ink">{current.contactName}</p>
            <p className="text-bodySm">
              <a href={`mailto:${current.email}`} className="text-green hover:underline">
                {current.email}
              </a>
            </p>
            {current.phone !== null && (
              <p className="text-bodySm">
                <a href={`tel:${current.phone}`} className="text-green hover:underline">
                  {current.phone}
                </a>
              </p>
            )}
            {address.length > 0 && (
              <address className="mt-3 text-bodySm not-italic leading-relaxed text-body-muted">
                {address.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
            )}
          </Panel>

          <Panel title="What they want">
            <dl className="flex flex-col gap-2 text-bodySm">
              <div className="flex justify-between gap-4">
                <dt className="text-body-muted">Monthly volume</dt>
                <dd className="text-ink">{VOLUME_LABEL[current.monthlyVolumeBand]}</dd>
              </div>
            </dl>

            {current.categoriesOfInterest.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {current.categoriesOfInterest.map((slug) => (
                  <span
                    key={slug}
                    className="rounded-pill border border-admin-border px-3 py-1 text-caption text-body-muted"
                  >
                    {slug}
                  </span>
                ))}
              </div>
            )}

            {current.notes !== null && (
              <p className="mt-3 rounded-md bg-admin-bg p-3 text-bodySm italic text-body-muted">
                “{current.notes}”
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-admin-border bg-white p-5 shadow-card">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 className="font-serif text-[17px] text-ink">{title}</h3>
        {note !== undefined && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted">
            {note}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export default WholesaleDetail;
