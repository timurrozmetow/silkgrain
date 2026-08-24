import type { AdminRole, AdminTeamList, AdminTeamMember } from '@silkgrain/contracts';
import { ADMIN_ROLE } from '@silkgrain/contracts';
import { Button, Field, Input, Select, Skeleton, StatusChip } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiRequestError, apiGet, apiPatch, apiPost } from '../lib/api';
import { useAuth } from '../store/auth';

/**
 * The team.
 *
 * Owner-only, and the one screen whose routes re-read `admin_users` on every request rather than
 * trusting the fifteen-minute token (D-32): it is the permission that could mint a permanent
 * replacement inside that window.
 *
 * The three refusals the API makes - you cannot change your own role, you cannot deactivate
 * yourself, and nothing may leave the shop with no active owner - are also drawn here, as disabled
 * controls with a reason. A control that is present and refused teaches somebody what the rule is;
 * one that is absent leaves them wondering whether the feature exists.
 */

const ROLE_NOTE: Record<AdminRole, string> = {
  owner: 'Everything, including this screen',
  manager: 'The catalogue, orders, prices and settings',
  support: 'Orders, enquiries and customers - reads elsewhere',
};

const WHEN = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function Team() {
  const me = useAuth((state) => state.admin);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin', 'team'],
    queryFn: ({ signal }) => apiGet<AdminTeamList>('/admin/team', signal),
  });

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await refetch();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (isError) {
    return (
      <p className="rounded-lg border border-admin-border bg-white p-6 text-bodySm text-terracotta">
        The team could not be loaded.
      </p>
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const activeOwners = data.members.filter(
    (member) => member.role === 'owner' && member.isActive,
  ).length;

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

      <AddMember busy={busy} onAct={act} />

      <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-[20px] text-ink">Administrators</h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-admin-muted">
            {activeOwners === 1 ? 'One active owner' : `${String(activeOwners)} active owners`}
          </span>
        </div>

        <div className="flex flex-col gap-4">
          {data.members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isSelf={member.id === me?.id}
              // Retiring or demoting the last active owner is refused by the API; the control says
              // so before it is pressed rather than after.
              isLastOwner={member.role === 'owner' && member.isActive && activeOwners === 1}
              busy={busy}
              onAct={act}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function AddMember({
  busy,
  onAct,
}: {
  busy: boolean;
  onAct: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<AdminRole>('support');
  const [password, setPassword] = useState('');

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button
          iconLeft="plus"
          onClick={() => {
            setOpen(true);
          }}
        >
          Add an administrator
        </Button>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
      <h2 className="mb-4 font-serif text-[18px] text-ink">Add an administrator</h2>

      <div className="grid grid-cols-2 gap-5 mobile:grid-cols-1">
        <Field label="Email" required hint="The login identity; it cannot be changed later">
          <Input
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>
        <Field label="Name" required>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field label="Role" required hint={ROLE_NOTE[role]}>
          <Select
            value={role}
            options={ADMIN_ROLE.map((entry) => ({ value: entry, label: entry }))}
            onChange={(event) => {
              setRole(event.target.value as AdminRole);
            }}
          />
        </Field>
        <Field
          label="Initial password"
          required
          hint="At least ten characters, with a number. Tell them out of band."
        >
          <Input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          loading={busy}
          onClick={() => {
            void onAct(() =>
              apiPost('/admin/team', {
                email: email.trim(),
                name: name.trim(),
                role,
                password,
              }).then(() => {
                setOpen(false);
                setEmail('');
                setName('');
                setPassword('');
              }),
            );
          }}
        >
          Create account
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}

function MemberRow({
  member,
  isSelf,
  isLastOwner,
  busy,
  onAct,
}: {
  member: AdminTeamMember;
  isSelf: boolean;
  isLastOwner: boolean;
  busy: boolean;
  onAct: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  const patch = (body: Record<string, unknown>) => {
    void onAct(() => apiPatch(`/admin/team/${String(member.id)}`, body));
  };

  // Why each control is locked, in the order the API would refuse them.
  const roleLock = isSelf
    ? 'You cannot change your own role'
    : isLastOwner
      ? 'The shop would be left with no active owner'
      : null;
  const activeLock = isSelf
    ? 'You cannot deactivate your own account'
    : isLastOwner
      ? 'The shop would be left with no active owner'
      : null;

  return (
    <div className="rounded-lg border border-admin-border bg-admin-bg p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-bodySm font-medium text-ink">{member.name}</span>
        <span className="text-caption text-admin-muted">{member.email}</span>
        {isSelf && <StatusChip tone="info">You</StatusChip>}
        {!member.isActive && <StatusChip tone="neutral">Deactivated</StatusChip>}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted">
          {member.lastLoginAt === null
            ? 'never signed in'
            : `last seen ${WHEN.format(new Date(member.lastLoginAt))}`}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 tablet:grid-cols-1">
        <Field label="Name">
          <Input
            defaultValue={member.name}
            disabled={busy}
            onBlur={(event) => {
              if (event.target.value !== member.name) patch({ name: event.target.value });
            }}
          />
        </Field>

        <Field label="Role" hint={roleLock ?? ROLE_NOTE[member.role]}>
          <Select
            value={member.role}
            disabled={busy || roleLock !== null}
            options={ADMIN_ROLE.map((entry) => ({ value: entry, label: entry }))}
            onChange={(event) => {
              patch({ role: event.target.value });
            }}
          />
        </Field>

        <Field label="Account" hint={activeLock ?? undefined}>
          <Select
            value={member.isActive ? 'active' : 'inactive'}
            disabled={busy || activeLock !== null}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Deactivated' },
            ]}
            onChange={(event) => {
              patch({ isActive: event.target.value === 'active' });
            }}
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {resetting ? (
          <>
            <Field label="New password" className="min-w-[240px]">
              <Input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            </Field>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void onAct(() =>
                  apiPatch(`/admin/team/${String(member.id)}/password`, { password }).then(() => {
                    setResetting(false);
                    setPassword('');
                  }),
                );
              }}
            >
              Set password
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setResetting(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || isSelf}
            onClick={() => {
              setResetting(true);
            }}
          >
            {/* Your own password goes through your account, which asks for the current one. */}
            {isSelf ? 'Change yours from your account' : 'Reset password'}
          </Button>
        )}
      </div>
    </div>
  );
}

export default Team;
