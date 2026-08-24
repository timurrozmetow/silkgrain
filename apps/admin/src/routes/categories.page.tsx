import type { AdminCategoryList, AdminCategoryNode, AdminCategoryRow } from '@silkgrain/contracts';
import {
  Button,
  EmptyState,
  Field,
  ICON_NAMES,
  Icon,
  Input,
  Select,
  Skeleton,
  StatusChip,
  Textarea,
  isIconName,
} from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  ApiRequestError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  apiUpload,
} from '../lib/api';
import { slugify } from '../lib/form-values';
import { useCan } from '../lib/permissions';

/**
 * Categories.
 *
 * The screen every other one waits on: a product needs a category and nothing else in the panel
 * can make one, so a freshly deployed shop starts here.
 *
 * Two things are drawn that a plainer list would leave out, and both are consequences the API
 * carries out silently otherwise. Beside each category is what the shop currently shows for it, so
 * the switch is never pressed without its cost visible; and deactivation is a two-step control
 * whose second step spells that cost out - products leaving the grid, sub-categories going with
 * them. The panel is not deciding anything here, it is saying out loud what
 * `PATCH /admin/categories/:id/active` is about to do.
 *
 * Everything the API refuses is either impossible to express here or explained where it would be:
 * a category with children is not offered a parent, a deactivated category is not offered as one,
 * and there is no delete anywhere, because there is no DELETE.
 */

interface FormState {
  name: string;
  slug: string;
  description: string;
  icon: string;
  parentId: string;
  position: string;
  metaTitle: string;
  metaDescription: string;
}

const BLANK = (parentId: number | null): FormState => ({
  name: '',
  slug: '',
  description: '',
  icon: '',
  parentId: parentId === null ? '' : String(parentId),
  position: '0',
  metaTitle: '',
  metaDescription: '',
});

const stateOf = (row: AdminCategoryRow): FormState => ({
  name: row.name,
  slug: row.slug,
  description: row.description ?? '',
  icon: row.icon ?? '',
  parentId: row.parentId === null ? '' : String(row.parentId),
  position: String(row.position),
  metaTitle: row.metaTitle ?? '',
  metaDescription: row.metaDescription ?? '',
});

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

const payloadOf = (form: FormState) => ({
  name: form.name.trim(),
  slug: form.slug.trim(),
  description: orNull(form.description),
  icon: orNull(form.icon),
  parentId: form.parentId === '' ? null : Number(form.parentId),
  position: Number(form.position) || 0,
  metaTitle: orNull(form.metaTitle),
  metaDescription: orNull(form.metaDescription),
});

/** What is open, if anything. One editor at a time, so a half-typed form is never left behind. */
type Editing = { mode: 'create'; parentId: number | null } | { mode: 'edit'; id: number } | null;

function Categories() {
  const mayWrite = useCan('products:write');

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: ({ signal }) => apiGet<AdminCategoryList>('/admin/categories', signal),
  });

  const [editing, setEditing] = useState<Editing>(null);
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
        The categories could not be loaded.
      </p>
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-11 w-48" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  const roots = data.items;
  const parentOptions = roots.filter((node) => node.isActive);

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

      {mayWrite && editing?.mode !== 'create' && (
        <div className="flex justify-end">
          <Button
            iconLeft="plus"
            onClick={() => {
              setEditing({ mode: 'create', parentId: null });
            }}
          >
            Add a category
          </Button>
        </div>
      )}

      {editing?.mode === 'create' && (
        <CategoryForm
          title={
            editing.parentId === null
              ? 'New category'
              : `New sub-category of ${roots.find((node) => node.id === editing.parentId)?.name ?? ''}`
          }
          initial={BLANK(editing.parentId)}
          parents={parentOptions}
          busy={busy}
          isNew
          onCancel={() => {
            setEditing(null);
          }}
          onSubmit={async (form) => {
            const ok = await act(() =>
              apiPost('/admin/categories', { ...payloadOf(form), isActive: true }),
            );
            if (ok) setEditing(null);
          }}
        />
      )}

      {roots.length === 0 ? (
        <EmptyState
          icon="squares-four"
          title="No categories yet"
          description="A product has to be filed under one, so this is where a new shop starts. The storefront’s menu is built from whatever is here."
        />
      ) : (
        roots.map((node) => (
          <CategoryCard
            key={node.id}
            node={node}
            parents={parentOptions}
            mayWrite={mayWrite}
            busy={busy}
            editing={editing}
            setEditing={setEditing}
            act={act}
          />
        ))
      )}
    </div>
  );
}

// -------------------------------------------------------------------------------------- a card

interface CardProps {
  node: AdminCategoryNode;
  parents: AdminCategoryNode[];
  mayWrite: boolean;
  busy: boolean;
  editing: Editing;
  setEditing: (editing: Editing) => void;
  act: (action: () => Promise<unknown>) => Promise<boolean>;
}

function CategoryCard({ node, parents, mayWrite, busy, editing, setEditing, act }: CardProps) {
  const isEditing = editing?.mode === 'edit' && editing.id === node.id;

  return (
    <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
      <CategoryHeader
        row={node}
        childCount={node.children.length}
        mayWrite={mayWrite}
        busy={busy}
        onEdit={() => {
          setEditing({ mode: 'edit', id: node.id });
        }}
        onAddChild={() => {
          setEditing({ mode: 'create', parentId: node.id });
        }}
        act={act}
      />

      {isEditing && (
        <div className="mt-5">
          <CategoryForm
            title={`Edit ${node.name}`}
            initial={stateOf(node)}
            // A category with children of its own cannot be filed under another one - the API
            // refuses it, so the control does not offer it.
            parents={node.children.length > 0 ? [] : parents.filter((row) => row.id !== node.id)}
            busy={busy}
            isNew={false}
            onCancel={() => {
              setEditing(null);
            }}
            onSubmit={async (form) => {
              const ok = await act(() =>
                apiPut(`/admin/categories/${String(node.id)}`, payloadOf(form)),
              );
              if (ok) setEditing(null);
            }}
          />
        </div>
      )}

      {node.children.length > 0 && (
        <ul className="mt-5 flex flex-col gap-3 border-l-2 border-admin-border pl-5 mobile:pl-3">
          {node.children.map((child) => {
            const childEditing = editing?.mode === 'edit' && editing.id === child.id;
            return (
              <li key={child.id} className="rounded-lg border border-admin-border bg-admin-bg p-4">
                <CategoryHeader
                  row={child}
                  childCount={0}
                  mayWrite={mayWrite}
                  busy={busy}
                  onEdit={() => {
                    setEditing({ mode: 'edit', id: child.id });
                  }}
                  act={act}
                />
                {childEditing && (
                  <div className="mt-4">
                    <CategoryForm
                      title={`Edit ${child.name}`}
                      initial={stateOf(child)}
                      parents={parents}
                      busy={busy}
                      isNew={false}
                      onCancel={() => {
                        setEditing(null);
                      }}
                      onSubmit={async (form) => {
                        const ok = await act(() =>
                          apiPut(`/admin/categories/${String(child.id)}`, payloadOf(form)),
                        );
                        if (ok) setEditing(null);
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The line an editor scans: what it is called, what is in it, and what may be done to it. */
function CategoryHeader({
  row,
  childCount,
  mayWrite,
  busy,
  onEdit,
  onAddChild,
  act,
}: {
  row: AdminCategoryRow;
  childCount: number;
  mayWrite: boolean;
  busy: boolean;
  onEdit: () => void;
  onAddChild?: () => void;
  act: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-start gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-cream text-green">
        {row.imageUrl !== null ? (
          <img src={row.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon name={isIconName(row.icon) ? row.icon : 'squares-four'} size={20} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-serif text-[19px] leading-tight text-ink">{row.name}</h2>
          {!row.isActive && <StatusChip tone="neutral">Deactivated</StatusChip>}
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-admin-muted">/shop/c/{row.slug}</p>
        <p className="mt-1.5 text-caption text-admin-muted">
          {countLine(row)}
          {childCount > 0 &&
            ` · ${String(childCount)} sub-categor${childCount === 1 ? 'y' : 'ies'}`}
        </p>
      </div>

      {mayWrite && (
        <div className="flex flex-wrap items-center gap-2">
          {onAddChild && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onAddChild}>
              Add sub-category
            </Button>
          )}

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared straight away, so choosing the same file twice fires the change again.
              event.target.value = '';
              if (!file) return;
              const body = new FormData();
              body.append('file', file);
              void act(() => apiUpload(`/admin/categories/${String(row.id)}/image`, body));
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            {row.imageUrl === null ? 'Add image' : 'Replace image'}
          </Button>
          {row.imageUrl !== null && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void act(() => apiDelete(`/admin/categories/${String(row.id)}/image`));
              }}
            >
              Remove image
            </Button>
          )}

          <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
            Edit
          </Button>

          {row.isActive ? (
            confirming ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy}
                  onClick={() => {
                    void act(() =>
                      apiPatch(`/admin/categories/${String(row.id)}/active`, { isActive: false }),
                    ).then(() => {
                      setConfirming(false);
                    });
                  }}
                >
                  Yes, deactivate
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  Keep it
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Deactivate
              </Button>
            )
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void act(() =>
                  apiPatch(`/admin/categories/${String(row.id)}/active`, { isActive: true }),
                );
              }}
            >
              Reactivate
            </Button>
          )}
        </div>
      )}

      {confirming && (
        // The whole point of the second step. Deactivating is not "hiding a heading": it takes
        // every product filed under this category out of the grid, out of search and out of the
        // mega-menu, because a product is in the shop only while its category is.
        <p className="w-full rounded-md border border-gold/40 bg-cream px-4 py-3 text-bodySm text-ink">
          {deactivationWarning(row, childCount)}
        </p>
      )}
    </div>
  );
}

function countLine(row: AdminCategoryRow): string {
  if (row.productCount === 0) return 'No products filed here';
  const filed = `${String(row.productCount)} product${row.productCount === 1 ? '' : 's'} filed here`;
  if (!row.isActive) return `${filed} · none in the shop while this is off`;
  return `${filed} · ${String(row.liveCount)} in the shop`;
}

function deactivationWarning(row: AdminCategoryRow, childCount: number): string {
  const parts: string[] = [];
  parts.push(
    row.liveCount === 0
      ? 'Nothing is in the shop under this category at the moment.'
      : `${String(row.liveCount)} product${row.liveCount === 1 ? '' : 's'} will leave the shop — the grid, search and the menu.`,
  );
  if (childCount > 0) {
    parts.push(
      `Its ${String(childCount)} sub-categor${childCount === 1 ? 'y goes' : 'ies go'} with it, and so do their products.`,
    );
  }
  parts.push('Nothing is deleted; switching it back on restores everything.');
  return parts.join(' ');
}

// -------------------------------------------------------------------------------------- a form

function CategoryForm({
  title,
  initial,
  parents,
  busy,
  isNew,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: FormState;
  parents: AdminCategoryNode[];
  busy: boolean;
  isNew: boolean;
  onCancel: () => void;
  onSubmit: (form: FormState) => void | Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const update = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const slugChanged = !isNew && form.slug !== initial.slug;

  return (
    <section className="rounded-lg border border-admin-border bg-admin-bg p-5 mobile:p-4">
      <h3 className="mb-4 font-serif text-[18px] text-ink">{title}</h3>

      <div className="grid grid-cols-2 gap-5 mobile:grid-cols-1">
        <Field label="Name" required>
          <Input
            value={form.name}
            onChange={(event) => {
              const name = event.target.value;
              // The slug follows the name until somebody edits it by hand, and only while the
              // category is new: an existing slug is a published address.
              update(
                isNew && form.slug === slugify(form.name)
                  ? { name, slug: slugify(name) }
                  : { name },
              );
            }}
          />
        </Field>

        <Field
          label="Slug"
          required
          hint={
            slugChanged
              ? 'This is the category’s address. Renaming it breaks every existing link to /shop/c/' +
                initial.slug
              : 'The category’s address: /shop/c/this'
          }
        >
          <Input
            value={form.slug}
            onChange={(event) => {
              update({ slug: event.target.value });
            }}
          />
        </Field>

        <Field
          label="Parent"
          hint={
            parents.length === 0 && form.parentId === ''
              ? 'This category has sub-categories of its own, so it stays at the top level'
              : 'The shop’s menu is two levels deep'
          }
        >
          <Select
            value={form.parentId}
            disabled={parents.length === 0 && form.parentId === ''}
            options={[
              { value: '', label: 'Top level' },
              ...parents.map((row) => ({ value: String(row.id), label: row.name })),
            ]}
            onChange={(event) => {
              update({ parentId: event.target.value });
            }}
          />
        </Field>

        <Field label="Position" hint="Lower numbers come first in the menu">
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

        <Field label="Icon" hint="Drawn in the mega-menu. Only icons this build ships are offered.">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-green">
              <Icon name={isIconName(form.icon) ? form.icon : 'squares-four'} size={18} />
            </span>
            <Select
              className="flex-1"
              value={form.icon}
              options={[
                { value: '', label: 'No icon' },
                ...ICON_NAMES.map((name) => ({ value: name, label: name })),
              ]}
              onChange={(event) => {
                update({ icon: event.target.value });
              }}
            />
          </div>
        </Field>

        <Field label="Meta title" hint="Falls back to the name in search results">
          <Input
            value={form.metaTitle}
            onChange={(event) => {
              update({ metaTitle: event.target.value });
            }}
          />
        </Field>

        <Field label="Description" className="col-span-2 mobile:col-span-1">
          <Textarea
            rows={3}
            value={form.description}
            onChange={(event) => {
              update({ description: event.target.value });
            }}
          />
        </Field>

        <Field label="Meta description" className="col-span-2 mobile:col-span-1">
          <Textarea
            rows={2}
            value={form.metaDescription}
            onChange={(event) => {
              update({ metaDescription: event.target.value });
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
          {isNew ? 'Create category' : 'Save changes'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {isNew && (
        // Said here rather than offered as a switch: a category created switched off cannot hold a
        // visible product, and nobody creating one means that. Retiring one is its own action.
        <p className="mt-3 text-caption text-admin-muted">
          It goes live as soon as it is created. Nothing appears in the shop under it until a
          product is filed there.
        </p>
      )}
    </section>
  );
}

export default Categories;
