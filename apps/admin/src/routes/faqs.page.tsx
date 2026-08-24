import type { AdminFaqList, AdminFaqRow, FaqCategory } from '@silkgrain/contracts';
import { FAQ_CATEGORY } from '@silkgrain/contracts/constants';
import {
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  StatusChip,
  Textarea,
} from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiRequestError, apiGet, apiPatch, apiPost, apiPut } from '../lib/api';
import { useCan } from '../lib/permissions';

/**
 * The FAQ.
 *
 * Grouped by category here as well as on the Help page, but from a flat list the server sorts by
 * category then position — so two entries fighting over the same position are next to each other
 * on screen rather than discovered by a customer reading them in the wrong order.
 *
 * There is no delete. An answer a customer has been given is worth keeping even once it stops
 * being shown, and hiding it is one click.
 */

const CATEGORY_LABEL: Record<FaqCategory, string> = {
  ordering: 'Ordering',
  shipping: 'Shipping & delivery',
  products: 'Products',
  wholesale: 'Wholesale',
  returns: 'Returns & refunds',
};

interface FormState {
  category: FaqCategory;
  question: string;
  answer: string;
  position: string;
}

const BLANK: FormState = { category: 'ordering', question: '', answer: '', position: '0' };

const stateOf = (row: AdminFaqRow): FormState => ({
  category: row.category,
  question: row.question,
  answer: row.answer,
  position: String(row.position),
});

const payloadOf = (form: FormState) => ({
  category: form.category,
  question: form.question.trim(),
  answer: form.answer.trim(),
  position: Number(form.position) || 0,
});

function Faqs() {
  const mayWrite = useCan('content:write');

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin', 'faqs'],
    queryFn: ({ signal }) => apiGet<AdminFaqList>('/admin/faqs', signal),
  });

  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      await refetch();
      return true;
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'That did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (isError) {
    return (
      <p className="rounded-lg border border-admin-border bg-white p-6 text-bodySm text-terracotta">
        The FAQ could not be loaded.
      </p>
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-11 w-40" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const grouped = FAQ_CATEGORY.map((category) => ({
    category,
    rows: data.items.filter((row) => row.category === category),
  })).filter((group) => group.rows.length > 0);

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

      {mayWrite && editing !== 'new' && (
        <div className="flex justify-end">
          <Button
            iconLeft="plus"
            onClick={() => {
              setEditing('new');
            }}
          >
            Add an entry
          </Button>
        </div>
      )}

      {editing === 'new' && (
        <FaqForm
          title="New entry"
          initial={BLANK}
          busy={busy}
          isNew
          onCancel={() => {
            setEditing(null);
          }}
          onSubmit={async (form) => {
            const ok = await act(() =>
              apiPost('/admin/faqs', { ...payloadOf(form), isPublished: true }),
            );
            if (ok) setEditing(null);
          }}
        />
      )}

      {data.items.length === 0 ? (
        <EmptyState
          icon="chat-circle-dots"
          title="No questions answered yet"
          description="The Help page draws its accordion from whatever is here, and shows nothing while it is empty."
        />
      ) : (
        grouped.map((group) => (
          <section
            key={group.category}
            className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4"
          >
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 className="font-serif text-[20px] text-ink">{CATEGORY_LABEL[group.category]}</h2>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-admin-muted">
                {group.rows.length === 1 ? 'one entry' : `${String(group.rows.length)} entries`}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {group.rows.map((row) => (
                <div key={row.id} className="rounded-lg border border-admin-border bg-admin-bg p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="mt-0.5 shrink-0 font-mono text-[11px] text-admin-muted">
                      #{row.position}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-bodySm font-medium text-ink">{row.question}</p>
                      <p className="mt-1 line-clamp-2 text-caption text-admin-muted">
                        {row.answer}
                      </p>
                    </div>
                    {!row.isPublished && <StatusChip tone="neutral">Hidden</StatusChip>}

                    {mayWrite && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setEditing(editing === row.id ? null : row.id);
                          }}
                        >
                          {editing === row.id ? 'Close' : 'Edit'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            void act(() =>
                              apiPatch(`/admin/faqs/${String(row.id)}/published`, {
                                isPublished: !row.isPublished,
                              }),
                            );
                          }}
                        >
                          {row.isPublished ? 'Hide' : 'Show'}
                        </Button>
                      </div>
                    )}
                  </div>

                  {editing === row.id && (
                    <div className="mt-4">
                      <FaqForm
                        title="Edit entry"
                        initial={stateOf(row)}
                        busy={busy}
                        isNew={false}
                        onCancel={() => {
                          setEditing(null);
                        }}
                        onSubmit={async (form) => {
                          const ok = await act(() =>
                            apiPut(`/admin/faqs/${String(row.id)}`, payloadOf(form)),
                          );
                          if (ok) setEditing(null);
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function FaqForm({
  title,
  initial,
  busy,
  isNew,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: FormState;
  busy: boolean;
  isNew: boolean;
  onCancel: () => void;
  onSubmit: (form: FormState) => void | Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const update = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  return (
    <section className="rounded-lg border border-admin-border bg-white p-5 mobile:p-4">
      <h3 className="mb-4 font-serif text-[17px] text-ink">{title}</h3>

      <div className="grid grid-cols-2 gap-5 mobile:grid-cols-1">
        <Field label="Section" required hint="Which heading it appears under on /help">
          <Select
            value={form.category}
            options={FAQ_CATEGORY.map((category) => ({
              value: category,
              label: CATEGORY_LABEL[category],
            }))}
            onChange={(event) => {
              update({ category: event.target.value as FaqCategory });
            }}
          />
        </Field>

        <Field label="Position" hint="Lower numbers come first within the section">
          <Input
            type="number"
            min={0}
            max={9999}
            value={form.position}
            onChange={(event) => {
              update({ position: event.target.value });
            }}
          />
        </Field>

        <Field label="Question" required className="col-span-2 mobile:col-span-1">
          <Input
            value={form.question}
            onChange={(event) => {
              update({ question: event.target.value });
            }}
          />
        </Field>

        <Field
          label="Answer"
          required
          className="col-span-2 mobile:col-span-1"
          hint="Markdown. A blank line starts a new paragraph."
        >
          <Textarea
            rows={5}
            value={form.answer}
            onChange={(event) => {
              update({ answer: event.target.value });
            }}
          />
        </Field>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button
          loading={busy}
          onClick={() => {
            void onSubmit(form);
          }}
        >
          {isNew ? 'Add entry' : 'Save changes'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

export default Faqs;
