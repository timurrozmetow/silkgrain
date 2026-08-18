import type {
  AdminAuditActors,
  AdminAuditEntry,
  AdminAuditResponse,
  AdminAuditRow,
} from '@silkgrain/contracts';
import { AUDIT_ACTION } from '@silkgrain/contracts';
import { Button, Field, Icon, Select, Skeleton, StatusChip } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { apiGet } from '../lib/api';
import { ACTION_PHRASE, formatAuditValue } from '../lib/audit-format';

/**
 * What administrators have done.
 *
 * Four filters, because the screen answers three questions and no more: why is this row like this,
 * what did this person do, and who has been touching prices. A control per column would answer all
 * three worse.
 *
 * Paging is a cursor, not numbered pages: nobody asks for page nine of an audit log, and the table
 * only grows, so an offset scan would get slower every week. "Older" is the only direction that
 * means anything, so it is the only one offered.
 */
const route = getRouteApi('/audit');

const WHEN = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function Audit() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/audit' });

  const query = new URLSearchParams();
  if (search.actor !== undefined) query.set('actor', search.actor);
  if (search.action !== undefined) query.set('action', search.action);
  if (search.before !== undefined) query.set('before', String(search.before));
  query.set('limit', '50');

  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'audit', query.toString()],
    queryFn: ({ signal }) => apiGet<AdminAuditResponse>(`/admin/audit?${query.toString()}`, signal),
    placeholderData: (previous) => previous,
  });

  const { data: actors } = useQuery({
    queryKey: ['admin', 'audit', 'actors'],
    queryFn: ({ signal }) => apiGet<AdminAuditActors>('/admin/audit/actors', signal),
  });

  const patch = (next: Record<string, string | number | undefined>) => {
    void navigate({
      search: (previous) => {
        // Any filter change returns to the newest page: a cursor from the old filter would point
        // into a list that no longer contains it.
        const merged = { ...previous, ...next, before: undefined };
        return Object.fromEntries(
          Object.entries(merged).filter(([, value]) => value !== undefined && value !== ''),
        );
      },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-admin-border bg-white p-5">
        <Field label="Who" className="min-w-[200px]">
          <Select
            value={search.actor ?? ''}
            options={[
              { value: '', label: 'Anybody' },
              ...(actors?.actors ?? []).map((actor) => ({
                // A deleted account keeps its entries and its name; `deleted` is how they are
                // asked for, since there is no id left to ask by.
                value: actor.actorId === null ? 'deleted' : String(actor.actorId),
                label: `${actor.name} (${String(actor.entryCount)})`,
              })),
            ]}
            onChange={(event) => {
              patch({ actor: event.target.value === '' ? undefined : event.target.value });
            }}
          />
        </Field>

        <Field label="What" className="min-w-[220px]">
          <Select
            value={search.action ?? ''}
            options={[
              { value: '', label: 'Everything' },
              ...AUDIT_ACTION.map((action) => ({ value: action, label: action })),
            ]}
            onChange={(event) => {
              patch({ action: event.target.value === '' ? undefined : event.target.value });
            }}
          />
        </Field>
      </div>

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <h2 className="font-serif text-[20px] text-ink">Audit log</h2>

        {isError ? (
          <p className="mt-5 text-bodySm text-terracotta">The log could not be loaded.</p>
        ) : isPending ? (
          <div className="mt-5 flex flex-col gap-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <p className="mt-5 text-bodySm text-admin-muted">
            {search.actor === undefined && search.action === undefined
              ? 'Nothing has been recorded yet. Every change an administrator makes appears here.'
              : 'No entries match those filters.'}
          </p>
        ) : (
          <>
            <ol className="mt-5 flex flex-col">
              {data.items.map((row) => (
                <AuditRow key={row.id} row={row} />
              ))}
            </ol>

            <div className="mt-6 flex items-center justify-between gap-4">
              <Button
                variant="outline"
                size="sm"
                disabled={search.before === undefined}
                onClick={() => {
                  // Back to the top rather than a real "newer" page: without keeping the whole
                  // cursor stack, one step back is a promise this screen cannot keep. The key is
                  // removed rather than set to undefined - `exactOptionalPropertyTypes` is on, and
                  // "absent" and "present but undefined" are different things here.
                  void navigate({
                    search: ({ before: _dropped, ...rest }) => rest,
                  });
                }}
              >
                Newest
              </Button>

              {data.nextCursor !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const cursor = data.nextCursor;
                    void navigate({
                      search: ({ before: _dropped, ...rest }) =>
                        cursor === null ? rest : { ...rest, before: cursor },
                    });
                  }}
                >
                  Older
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** One entry, expanding to the diff the detail endpoint serves. */
function AuditRow({ row }: { row: AdminAuditRow }) {
  const [open, setOpen] = useState(false);

  const { data: entry } = useQuery({
    queryKey: ['admin', 'audit', 'entry', row.id],
    queryFn: ({ signal }) => apiGet<AdminAuditEntry>(`/admin/audit/${String(row.id)}`, signal),
    // The values are only fetched when somebody wants them, which is what keeps a page of fifty
    // entries from hauling every payload it can see.
    enabled: open,
  });

  return (
    <li className="border-b border-admin-border/60 py-3 last:border-0">
      <button
        type="button"
        className="flex w-full items-start gap-3 text-left"
        onClick={() => {
          setOpen((previous) => !previous);
        }}
      >
        <Icon
          name={open ? 'caret-down' : 'caret-right'}
          size={14}
          className="mt-1 shrink-0 text-admin-muted"
        />
        <span className="flex-1">
          <span className="text-bodySm text-ink">
            <strong className="font-medium">{row.actorName}</strong> {ACTION_PHRASE[row.action]}{' '}
            {row.entityLabel !== null && <strong className="font-medium">{row.entityLabel}</strong>}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-admin-muted">
              {WHEN.format(new Date(row.createdAt))}
            </span>
            <StatusChip tone="neutral">{row.actorRole}</StatusChip>
            {row.changedFields.length > 0 && (
              <span className="text-caption text-admin-muted">
                {row.changedFields.length === 1
                  ? row.changedFields[0]
                  : `${String(row.changedFields.length)} fields`}
              </span>
            )}
          </span>
          {row.note !== null && (
            <span className="mt-1 block text-caption italic text-body-muted">“{row.note}”</span>
          )}
        </span>
      </button>

      {open && (
        <div className="ml-7 mt-3">
          {entry === undefined ? <Skeleton className="h-16 w-full" /> : <AuditDiff entry={entry} />}
        </div>
      )}
    </li>
  );
}

function AuditDiff({ entry }: { entry: AdminAuditEntry }) {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  return (
    <div className="rounded-md border border-admin-border bg-admin-bg p-3">
      {keys.length === 0 ? (
        <p className="text-caption text-admin-muted">
          {/* A password reset records that it happened and nothing about what changed. */}
          No field values were recorded for this action.
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <tbody>
            {keys.map((key) => (
              <tr key={key} className="align-top">
                <td className="py-1 pr-4 font-mono text-[11px] text-admin-muted">{key}</td>
                <td className="py-1 pr-3 text-caption text-body-muted line-through">
                  {formatAuditValue(key, before[key])}
                </td>
                <td className="py-1 text-caption text-ink">{formatAuditValue(key, after[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-3 font-mono text-[10px] text-admin-muted">
        {entry.ip ?? 'no address'} · {entry.userAgent ?? 'no user agent'}
      </p>
    </div>
  );
}

export default Audit;
