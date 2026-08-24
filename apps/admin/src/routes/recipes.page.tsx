import type {
  AdminProductListResponse,
  AdminRecipeDetail,
  AdminRecipeList,
  AdminRecipeRow,
  RecipeDifficulty,
} from '@silkgrain/contracts';
import { RECIPE_DIFFICULTY } from '@silkgrain/contracts/constants';
import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  Icon,
  Input,
  Select,
  Skeleton,
  StatusChip,
  Textarea,
} from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { ApiRequestError, apiGet, apiPatch, apiPost, apiPut, apiUpload } from '../lib/api';
import { slugify } from '../lib/form-values';
import { useCan } from '../lib/permissions';

/**
 * Recipes.
 *
 * `/recipes` is in the storefront's main navigation and opened empty until this existed, which is
 * the same gap categories had: a public endpoint, a seed, and no writer in production.
 *
 * Two things the screen is careful about. Publishing is its own control rather than a field in the
 * form, because it stamps `published_at` and a stale form must not put a recipe back that somebody
 * took down. And the ingredient list is a set of checkboxes over the real catalogue rather than a
 * free-text field: "Shop the ingredients" links to products, and a name typed by hand would link
 * to nothing.
 */

const DIFFICULTY_LABEL: Record<RecipeDifficulty, string> = {
  easy: 'Easy',
  medium: 'Intermediate',
  hard: 'Advanced',
};

interface FormState {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  prepMinutes: string;
  cookMinutes: string;
  servings: string;
  difficulty: RecipeDifficulty;
  imageAlt: string;
  metaTitle: string;
  metaDescription: string;
  productIds: number[];
}

const BLANK: FormState = {
  title: '',
  slug: '',
  excerpt: '',
  body: '## Ingredients\n\n- \n\n## Method\n\n1. ',
  prepMinutes: '15',
  cookMinutes: '30',
  servings: '4',
  difficulty: 'medium',
  imageAlt: '',
  metaTitle: '',
  metaDescription: '',
  productIds: [],
};

const stateOf = (detail: AdminRecipeDetail): FormState => ({
  title: detail.title,
  slug: detail.slug,
  excerpt: detail.excerpt,
  body: detail.body,
  prepMinutes: String(detail.prepMinutes),
  cookMinutes: String(detail.cookMinutes),
  servings: String(detail.servings),
  difficulty: detail.difficulty,
  imageAlt: detail.imageAlt ?? '',
  metaTitle: detail.metaTitle ?? '',
  metaDescription: detail.metaDescription ?? '',
  productIds: detail.productIds,
});

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

const payloadOf = (form: FormState) => ({
  title: form.title.trim(),
  slug: form.slug.trim(),
  excerpt: form.excerpt.trim(),
  body: form.body.trim(),
  prepMinutes: Number(form.prepMinutes) || 0,
  cookMinutes: Number(form.cookMinutes) || 0,
  servings: Number(form.servings) || 1,
  difficulty: form.difficulty,
  imageAlt: orNull(form.imageAlt),
  metaTitle: orNull(form.metaTitle),
  metaDescription: orNull(form.metaDescription),
  productIds: form.productIds,
});

function Recipes() {
  const mayWrite = useCan('content:write');

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin', 'recipes'],
    queryFn: ({ signal }) => apiGet<AdminRecipeList>('/admin/recipes', signal),
  });

  // The whole catalogue, for the ingredient checkboxes. One request for the screen rather than
  // one per open editor, and 100 is above the number of products this shop is ever likely to hold
  // in one page of the admin list.
  const products = useQuery({
    queryKey: ['admin', 'products', 'for-recipes'],
    queryFn: ({ signal }) =>
      apiGet<AdminProductListResponse>('/admin/products?status=all&perPage=100', signal),
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
        The recipes could not be loaded.
      </p>
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-11 w-40" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  const catalogue = products.data?.items ?? [];

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
            Write a recipe
          </Button>
        </div>
      )}

      {editing === 'new' && (
        <RecipeForm
          title="New recipe"
          initial={BLANK}
          catalogue={catalogue}
          busy={busy}
          isNew
          onCancel={() => {
            setEditing(null);
          }}
          onSubmit={async (form) => {
            const ok = await act(() =>
              apiPost('/admin/recipes', { ...payloadOf(form), isPublished: false }),
            );
            if (ok) setEditing(null);
          }}
        />
      )}

      {data.items.length === 0 ? (
        <EmptyState
          icon="cooking-pot"
          title="No recipes yet"
          description="/recipes is in the shop’s main navigation and shows an empty page until something here is published."
        />
      ) : (
        data.items.map((row) => (
          <RecipeCard
            key={row.id}
            row={row}
            catalogue={catalogue}
            mayWrite={mayWrite}
            busy={busy}
            isOpen={editing === row.id}
            onToggle={() => {
              setEditing(editing === row.id ? null : row.id);
            }}
            onClose={() => {
              setEditing(null);
            }}
            act={act}
          />
        ))
      )}
    </div>
  );
}

type Catalogue = AdminProductListResponse['items'];

function RecipeCard({
  row,
  catalogue,
  mayWrite,
  busy,
  isOpen,
  onToggle,
  onClose,
  act,
}: {
  row: AdminRecipeRow;
  catalogue: Catalogue;
  mayWrite: boolean;
  busy: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  act: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  // Fetched only when the editor is open: the list carries no body, and six method sections is
  // exactly what the list response leaves out on purpose.
  const detail = useQuery({
    queryKey: ['admin', 'recipe', row.id],
    enabled: isOpen,
    queryFn: ({ signal }) => apiGet<AdminRecipeDetail>(`/admin/recipes/${String(row.id)}`, signal),
  });

  return (
    <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-cream text-green">
          {row.imageUrl === null ? (
            <Icon name="cooking-pot" size={22} />
          ) : (
            <img src={row.imageUrl} alt="" className="h-full w-full object-cover" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-serif text-[19px] leading-tight text-ink">{row.title}</h2>
            {row.isPublished ? (
              <StatusChip tone="positive">Live</StatusChip>
            ) : (
              <StatusChip tone="neutral">Draft</StatusChip>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-admin-muted">/recipes/{row.slug}</p>
          <p className="mt-1.5 text-caption text-admin-muted">
            {row.prepMinutes + row.cookMinutes} min · serves {row.servings} ·{' '}
            {DIFFICULTY_LABEL[row.difficulty]} ·{' '}
            {row.productCount === 0
              ? 'no ingredients linked'
              : `${String(row.productCount)} ingredient${row.productCount === 1 ? '' : 's'} linked`}
          </p>
        </div>

        {mayWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                const body = new FormData();
                body.append('file', file);
                void act(() => apiUpload(`/admin/recipes/${String(row.id)}/image`, body));
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
            <Button size="sm" variant="outline" disabled={busy} onClick={onToggle}>
              {isOpen ? 'Close' : 'Edit'}
            </Button>
            <Button
              size="sm"
              variant={row.isPublished ? 'ghost' : 'primary'}
              disabled={busy}
              onClick={() => {
                void act(() =>
                  apiPatch(`/admin/recipes/${String(row.id)}/published`, {
                    isPublished: !row.isPublished,
                  }),
                );
              }}
            >
              {row.isPublished ? 'Take down' : 'Publish'}
            </Button>
          </div>
        )}
      </div>

      {isOpen && (
        <div className="mt-5">
          {detail.isPending ? (
            <Skeleton className="h-80 w-full" />
          ) : detail.isError ? (
            <p className="text-bodySm text-terracotta">That recipe could not be loaded.</p>
          ) : (
            <RecipeForm
              title={`Edit ${row.title}`}
              initial={stateOf(detail.data)}
              catalogue={catalogue}
              busy={busy}
              isNew={false}
              onCancel={onClose}
              onSubmit={async (form) => {
                const ok = await act(() =>
                  apiPut(`/admin/recipes/${String(row.id)}`, payloadOf(form)),
                );
                if (ok) {
                  await detail.refetch();
                  onClose();
                }
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

function RecipeForm({
  title,
  initial,
  catalogue,
  busy,
  isNew,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: FormState;
  catalogue: Catalogue;
  busy: boolean;
  isNew: boolean;
  onCancel: () => void;
  onSubmit: (form: FormState) => void | Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const update = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const toggleProduct = (id: number) => {
    setForm((current) => ({
      ...current,
      productIds: current.productIds.includes(id)
        ? current.productIds.filter((entry) => entry !== id)
        : [...current.productIds, id],
    }));
  };

  return (
    <section className="rounded-lg border border-admin-border bg-admin-bg p-5 mobile:p-4">
      <h3 className="mb-4 font-serif text-[18px] text-ink">{title}</h3>

      <div className="grid grid-cols-2 gap-5 mobile:grid-cols-1">
        <Field label="Title" required>
          <Input
            value={form.title}
            onChange={(event) => {
              const value = event.target.value;
              // The slug follows the title only while the recipe is new; an existing one is a
              // published address.
              update(
                isNew && form.slug === slugify(form.title)
                  ? { title: value, slug: slugify(value) }
                  : { title: value },
              );
            }}
          />
        </Field>

        <Field label="Slug" required hint="The recipe’s address: /recipes/this">
          <Input
            value={form.slug}
            onChange={(event) => {
              update({ slug: event.target.value });
            }}
          />
        </Field>

        <Field
          label="Excerpt"
          required
          className="col-span-2 mobile:col-span-1"
          hint="One or two lines. It is what the card shows and what search engines quote."
        >
          <Textarea
            rows={2}
            value={form.excerpt}
            onChange={(event) => {
              update({ excerpt: event.target.value });
            }}
          />
        </Field>

        <div className="col-span-2 grid grid-cols-4 gap-5 tablet:grid-cols-2 mobile:col-span-1 mobile:grid-cols-2">
          <Field label="Prep, minutes" required>
            <Input
              type="number"
              min={0}
              value={form.prepMinutes}
              onChange={(event) => {
                update({ prepMinutes: event.target.value });
              }}
            />
          </Field>
          <Field label="Cook, minutes" required>
            <Input
              type="number"
              min={0}
              value={form.cookMinutes}
              onChange={(event) => {
                update({ cookMinutes: event.target.value });
              }}
            />
          </Field>
          <Field label="Serves" required>
            <Input
              type="number"
              min={1}
              value={form.servings}
              onChange={(event) => {
                update({ servings: event.target.value });
              }}
            />
          </Field>
          <Field label="Difficulty" required>
            <Select
              value={form.difficulty}
              options={RECIPE_DIFFICULTY.map((level) => ({
                value: level,
                label: DIFFICULTY_LABEL[level],
              }))}
              onChange={(event) => {
                update({ difficulty: event.target.value as RecipeDifficulty });
              }}
            />
          </Field>
        </div>

        <Field
          label="Method"
          required
          className="col-span-2 mobile:col-span-1"
          hint="Markdown. `## Ingredients` and `## Method` are the headings the page expects."
        >
          <Textarea
            rows={16}
            className="font-mono text-[13px]"
            value={form.body}
            onChange={(event) => {
              update({ body: event.target.value });
            }}
          />
        </Field>

        <Field
          label="Image description"
          className="col-span-2 mobile:col-span-1"
          hint="Read aloud to anyone who cannot see the photograph. Left empty if the image is decoration."
        >
          <Input
            value={form.imageAlt}
            onChange={(event) => {
              update({ imageAlt: event.target.value });
            }}
          />
        </Field>

        <Field label="Meta title">
          <Input
            value={form.metaTitle}
            onChange={(event) => {
              update({ metaTitle: event.target.value });
            }}
          />
        </Field>

        <Field label="Meta description">
          <Input
            value={form.metaDescription}
            onChange={(event) => {
              update({ metaDescription: event.target.value });
            }}
          />
        </Field>
      </div>

      <fieldset className="mt-6">
        <legend className="font-mono text-[11px] uppercase tracking-[0.14em] text-admin-muted">
          Shop the ingredients
        </legend>
        <p className="mt-1 text-caption text-admin-muted">
          The products this links to, in the order they are ticked. Chosen from the catalogue rather
          than typed, because the recipe page turns each one into a card.
        </p>
        <div className="mt-3 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto rounded-md border border-admin-border bg-white p-3 tablet:grid-cols-2 mobile:grid-cols-1">
          {catalogue.length === 0 ? (
            <p className="text-caption text-admin-muted">No products in the catalogue yet.</p>
          ) : (
            catalogue.map((product) => (
              <Checkbox
                key={product.id}
                checked={form.productIds.includes(product.id)}
                onChange={() => {
                  toggleProduct(product.id);
                }}
                label={product.name}
              />
            ))
          )}
        </div>
      </fieldset>

      <div className="mt-5 flex items-center gap-3">
        <Button
          loading={busy}
          onClick={() => {
            void onSubmit(form);
          }}
        >
          {isNew ? 'Create draft' : 'Save changes'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {isNew && (
        // Said rather than offered as a switch: publishing stamps the date, and a recipe with no
        // photograph and a half-written method is not something to put in the shop by accident.
        <p className="mt-3 text-caption text-admin-muted">
          It is saved as a draft. Add the photograph, then press Publish on the card.
        </p>
      )}
    </section>
  );
}

export default Recipes;
