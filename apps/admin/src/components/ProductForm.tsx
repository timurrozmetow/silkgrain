import type {
  AdminProductDetail,
  AdminProductInput,
  CategoryListResponse,
  Certification,
  Origin,
  ProductBadge,
  ProductStatus,
  WeightUnit,
} from '@silkgrain/contracts';
import {
  CERTIFICATION,
  ORIGIN,
  PRODUCT_BADGE,
  PRODUCT_STATUS,
  WEIGHT_UNIT,
} from '@silkgrain/contracts/constants';
import { Button, Card, Checkbox, Field, Icon, Input, Select, Textarea } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState, type FormEvent } from 'react';

import { ApiRequestError, apiGet, apiPost, apiPut } from '../lib/api';
import { centsToDollars, dollarsToCents, gramsToMg, mgToGrams, toInt } from '../lib/form-values';
import { useCan } from '../lib/permissions';

import { ProductImages } from './ProductImages';

/**
 * The one form that creates and edits a product.
 *
 * A person edits dollars and grams; `form-values.ts` converts those to cents and milligrams at the
 * boundary. The client validates only what saves an obviously doomed round trip - a missing name,
 * a price that will not parse - and lets the server be the authority on the rest, surfacing its
 * 422 and 409 messages rather than trying to predict them. The endpoints behind this
 * (`POST`/`PUT /api/admin/products`) already hold every real rule and are tested to.
 */

const ORIGIN_LABELS: Record<Origin, string> = {
  UZ: 'Uzbekistan',
  KZ: 'Kazakhstan',
  TM: 'Turkmenistan',
  KG: 'Kyrgyzstan',
  TJ: 'Tajikistan',
  MIXED: 'Mixed origin',
};

const STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

const CERT_LABELS: Record<Certification, string> = {
  organic: 'Organic',
  non_gmo: 'Non-GMO',
  halal: 'Halal',
  kosher: 'Kosher',
  gluten_free: 'Gluten free',
};

const BADGE_LABELS: Record<ProductBadge, string> = {
  bestseller: 'Bestseller',
  new: 'New',
  premium: 'Premium',
};

/** A variant while it is being edited: money and weight are strings here. */
interface VariantForm {
  id?: number;
  sku: string;
  weightLabel: string;
  weightValue: string;
  weightUnit: WeightUnit;
  weightGrams: string;
  price: string;
  compareAt: string;
  cost: string;
  stock: string;
  threshold: string;
  isDefault: boolean;
  isActive: boolean;
}

interface NutritionForm {
  servingSize: string;
  servingsPerContainer: string;
  calories: string;
  fat: string;
  satFat: string;
  carbs: string;
  sugars: string;
  fiber: string;
  protein: string;
  sodium: string;
  ingredients: string;
  allergens: string;
}

const EMPTY_VARIANT = (position: number): VariantForm => ({
  sku: '',
  weightLabel: '',
  weightValue: '',
  weightUnit: 'lb',
  weightGrams: '',
  price: '',
  compareAt: '',
  cost: '',
  stock: '0',
  threshold: '10',
  isDefault: position === 0,
  isActive: true,
});

const EMPTY_NUTRITION = (): NutritionForm => ({
  servingSize: '',
  servingsPerContainer: '',
  calories: '',
  fat: '',
  satFat: '',
  carbs: '',
  sugars: '',
  fiber: '',
  protein: '',
  sodium: '',
  ingredients: '',
  allergens: '',
});

interface ProductState {
  name: string;
  slug: string;
  subtitle: string;
  blurb: string;
  description: string;
  story: string;
  categoryId: string;
  origin: Origin;
  originRegion: string;
  status: ProductStatus;
  isFeatured: boolean;
  metaTitle: string;
  metaDescription: string;
  certifications: Certification[];
  badges: ProductBadge[];
  variants: VariantForm[];
  nutrition: NutritionForm | null;
}

function fromDetail(detail: AdminProductDetail): ProductState {
  return {
    name: detail.name,
    slug: detail.slug,
    subtitle: detail.subtitle ?? '',
    blurb: detail.blurb,
    description: detail.description,
    story: detail.story ?? '',
    categoryId: String(detail.categoryId),
    origin: detail.origin,
    originRegion: detail.originRegion ?? '',
    status: detail.status,
    isFeatured: detail.isFeatured,
    metaTitle: detail.metaTitle ?? '',
    metaDescription: detail.metaDescription ?? '',
    certifications: detail.certifications,
    badges: detail.badges,
    variants: detail.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      weightLabel: variant.weightLabel,
      weightValue: String(variant.weightValueMilli / 1000),
      weightUnit: variant.weightUnit,
      weightGrams: variant.weightGrams === null ? '' : String(variant.weightGrams),
      price: centsToDollars(variant.priceCents),
      compareAt: centsToDollars(variant.compareAtPriceCents),
      cost: centsToDollars(variant.costCents),
      stock: String(variant.stockQty),
      threshold: String(variant.lowStockThreshold),
      isDefault: variant.isDefault,
      isActive: variant.isActive,
    })),
    nutrition:
      detail.nutrition === null
        ? null
        : {
            servingSize: detail.nutrition.servingSize,
            servingsPerContainer:
              detail.nutrition.servingsPerContainer === null ||
              detail.nutrition.servingsPerContainer === undefined
                ? ''
                : String(detail.nutrition.servingsPerContainer),
            calories: String(detail.nutrition.calories),
            fat: mgToGrams(detail.nutrition.fatMg),
            satFat: mgToGrams(detail.nutrition.satFatMg),
            carbs: mgToGrams(detail.nutrition.carbsMg),
            sugars: mgToGrams(detail.nutrition.sugarsMg),
            fiber: mgToGrams(detail.nutrition.fiberMg),
            protein: mgToGrams(detail.nutrition.proteinMg),
            sodium: String(detail.nutrition.sodiumMg),
            ingredients: detail.nutrition.ingredientsText,
            allergens: detail.nutrition.allergensText ?? '',
          },
  };
}

const BLANK = (): ProductState => ({
  name: '',
  slug: '',
  subtitle: '',
  blurb: '',
  description: '',
  story: '',
  categoryId: '',
  origin: 'UZ',
  originRegion: '',
  status: 'draft',
  isFeatured: false,
  metaTitle: '',
  metaDescription: '',
  certifications: [],
  badges: [],
  variants: [EMPTY_VARIANT(0)],
  nutrition: null,
});

export function ProductForm({ productId }: { productId: number | null }) {
  const navigate = useNavigate();
  const isEdit = productId !== null;
  // Support reads the catalogue and does not write it. The form is still rendered, because
  // "is it in stock" is a support question and the answer is on this page.
  const mayWrite = useCan('products:write');

  const detail = useQuery({
    queryKey: ['admin', 'product', productId],
    enabled: isEdit,
    queryFn: ({ signal }) =>
      apiGet<AdminProductDetail>(`/admin/products/${String(productId)}`, signal),
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => apiGet<CategoryListResponse>('/categories', signal),
  });

  const [form, setForm] = useState<ProductState | null>(isEdit ? null : BLANK());
  const [error, setError] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed the form from the fetched product the first time it arrives.
  if (isEdit && form === null && detail.data !== undefined) {
    setForm(fromDetail(detail.data));
  }

  if (isEdit && detail.isError) {
    return (
      <Card padding="lg">
        <p className="text-bodySm text-terracotta">
          That product could not be loaded. It may have been deleted.
        </p>
      </Card>
    );
  }

  if (form === null) {
    return (
      <Card padding="lg">
        <p className="text-bodySm text-admin-muted">Loading…</p>
      </Card>
    );
  }

  const update = (patch: Partial<ProductState>) => {
    setForm((current) => (current === null ? current : { ...current, ...patch }));
  };

  const setVariant = (index: number, patch: Partial<VariantForm>) => {
    setForm((current) => {
      if (current === null) return current;
      const variants = current.variants.map((variant, i) =>
        i === index ? { ...variant, ...patch } : variant,
      );
      return { ...current, variants };
    });
  };

  /** Only one variant is the default; ticking one unticks the rest. */
  const setDefaultVariant = (index: number) => {
    setForm((current) => {
      if (current === null) return current;
      return {
        ...current,
        variants: current.variants.map((variant, i) => ({ ...variant, isDefault: i === index })),
      };
    });
  };

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || form === null) return;

    const problems = clientProblems(form);
    if (problems.length > 0) {
      setError(problems);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const payload = toPayload(form);
    if (payload === null) {
      setError(['A price or a weight could not be read as a number. Check the variant rows.']);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = isEdit
        ? await apiPut<AdminProductDetail>(`/admin/products/${String(productId)}`, payload)
        : await apiPost<AdminProductDetail>('/admin/products', payload);
      // The route's `parseParams` gives `id` as a number, so navigation supplies one too.
      void navigate({ to: '/products/$id/edit', params: { id: saved.id } });
    } catch (cause) {
      setSaving(false);
      setError(serverMessages(cause));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => void submit(event)} noValidate>
      {!mayWrite && (
        <p className="rounded-lg border border-admin-border bg-admin-bg px-5 py-3 text-bodySm text-body-muted">
          You can read this product but not change it. A manager or the owner edits the catalogue.
        </p>
      )}
      {/* One disabled fieldset rather than a `disabled` on forty controls: the browser propagates
          it, and a control added later is covered without anybody remembering to. */}
      <fieldset disabled={!mayWrite} className="contents">
        {error !== null && (
          <div
            role="alert"
            className="rounded-lg border border-terracotta/40 bg-terracotta-bg px-5 py-4 text-bodySm text-terracotta"
          >
            <p className="font-medium">This did not save:</p>
            <ul className="mt-1.5 list-disc pl-5">
              {error.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <h2 className="font-serif text-[24px] text-ink">
            {isEdit ? form.name || 'Edit product' : 'New product'}
          </h2>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void navigate({ to: '/products' })}
            >
              Cancel
            </Button>
            <Button type="submit" loading={saving} iconLeft="check">
              {isEdit ? 'Save changes' : 'Create product'}
            </Button>
          </div>
        </div>

        <Section title="Details">
          <div className="grid grid-cols-2 gap-5 mobile:grid-cols-1">
            <Field label="Name" required>
              <Input
                value={form.name}
                onChange={(event) => {
                  const name = event.target.value;
                  // The slug follows the name until an editor edits it by hand; after that it is left
                  // alone, because a published slug is a public address nobody wants silently moved.
                  update(
                    !isEdit && form.slug === slugify(form.name)
                      ? { name, slug: slugify(name) }
                      : { name },
                  );
                }}
              />
            </Field>
            <Field label="Slug" required hint="The product’s address: /product/this">
              <Input
                value={form.slug}
                onChange={(event) => {
                  update({ slug: event.target.value });
                }}
              />
            </Field>
            <Field label="Category" required>
              <Select
                value={form.categoryId}
                options={[
                  { value: '', label: 'Choose a category' },
                  ...(categories.data?.items ?? []).flatMap((node) => [
                    { value: String(node.id), label: node.name },
                    ...node.children.map((child) => ({
                      value: String(child.id),
                      label: `— ${child.name}`,
                    })),
                  ]),
                ]}
                onChange={(event) => {
                  update({ categoryId: event.target.value });
                }}
              />
            </Field>
            <Field label="Origin" required>
              <Select
                value={form.origin}
                options={ORIGIN.map((origin) => ({ value: origin, label: ORIGIN_LABELS[origin] }))}
                onChange={(event) => {
                  update({ origin: event.target.value as Origin });
                }}
              />
            </Field>
            <Field label="Origin region" hint="Fergana Valley, Samarkand…">
              <Input
                value={form.originRegion}
                onChange={(event) => {
                  update({ originRegion: event.target.value });
                }}
              />
            </Field>
            <Field label="Status" required>
              <Select
                value={form.status}
                options={PRODUCT_STATUS.map((status) => ({
                  value: status,
                  label: STATUS_LABELS[status],
                }))}
                onChange={(event) => {
                  update({ status: event.target.value as ProductStatus });
                }}
              />
            </Field>
          </div>

          <Field label="Blurb" required hint="One line, shown on the card" className="mt-5">
            <Input
              value={form.blurb}
              maxLength={300}
              onChange={(event) => {
                update({ blurb: event.target.value });
              }}
            />
          </Field>

          <Field label="Subtitle" className="mt-5">
            <Input
              value={form.subtitle}
              onChange={(event) => {
                update({ subtitle: event.target.value });
              }}
            />
          </Field>

          <Field label="Description" required className="mt-5">
            <Textarea
              rows={5}
              value={form.description}
              onChange={(event) => {
                update({ description: event.target.value });
              }}
            />
          </Field>

          <Field label="Origin story" className="mt-5">
            <Textarea
              rows={5}
              value={form.story}
              onChange={(event) => {
                update({ story: event.target.value });
              }}
            />
          </Field>

          <div className="mt-5">
            <Checkbox
              label="Feature this product on the home page"
              checked={form.isFeatured}
              onChange={(event) => {
                update({ isFeatured: event.target.checked });
              }}
            />
          </div>
        </Section>

        <Section title="Variants" note="Exactly one is the default">
          <div className="flex flex-col gap-4">
            {form.variants.map((variant, index) => (
              <VariantRow
                key={variant.id ?? `new-${String(index)}`}
                variant={variant}
                index={index}
                canRemove={form.variants.length > 1}
                onChange={(patch) => {
                  setVariant(index, patch);
                }}
                onDefault={() => {
                  setDefaultVariant(index);
                }}
                onRemove={() => {
                  update({ variants: form.variants.filter((_, i) => i !== index) });
                }}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            iconLeft="plus"
            className="mt-4"
            onClick={() => {
              update({ variants: [...form.variants, EMPTY_VARIANT(form.variants.length)] });
            }}
          >
            Add a variant
          </Button>
        </Section>

        {/* Images live only on the edit form: there is no product to attach one to until it exists,
          and they save on their own rather than with the form (see ProductImages). */}
        {isEdit && detail.data !== undefined && (
          <Section title="Images" note="Drag to add · first leads">
            <ProductImages productId={detail.data.id} initial={detail.data.images} />
          </Section>
        )}

        <Section title="Certifications & badges">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted">
            Certifications
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2.5">
            {CERTIFICATION.map((certification) => (
              <Chip
                key={certification}
                label={CERT_LABELS[certification]}
                active={form.certifications.includes(certification)}
                onClick={() => {
                  update({ certifications: toggle(form.certifications, certification) });
                }}
              />
            ))}
          </div>

          <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted">
            Badges
          </p>
          {/* Only the editorial three. `sale` and `organic` are derived and never stored (D-12):
            `sale` is a variant with a compare-at price, `organic` is the organic certification. */}
          <div className="mt-2.5 flex flex-wrap gap-2.5">
            {PRODUCT_BADGE.map((badge) => (
              <Chip
                key={badge}
                label={BADGE_LABELS[badge]}
                active={form.badges.includes(badge)}
                onClick={() => {
                  update({ badges: toggle(form.badges, badge) });
                }}
              />
            ))}
          </div>
        </Section>

        <Section
          title="Nutrition facts"
          note={form.nutrition === null ? 'No panel' : 'Marked entered on save'}
        >
          {form.nutrition === null ? (
            <div>
              <p className="text-bodySm text-admin-muted">
                This product has no nutrition panel. Adding one marks its figures as entered by
                hand, which is what separates them from the seed’s category-level references.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                iconLeft="plus"
                className="mt-4"
                onClick={() => {
                  update({ nutrition: EMPTY_NUTRITION() });
                }}
              >
                Add a nutrition panel
              </Button>
            </div>
          ) : (
            <NutritionPanel
              panel={form.nutrition}
              onChange={(patch) => {
                update({ nutrition: { ...form.nutrition, ...patch } as NutritionForm });
              }}
              onRemove={() => {
                update({ nutrition: null });
              }}
            />
          )}
        </Section>

        <Section title="Search engine">
          <div className="grid grid-cols-2 gap-5 mobile:grid-cols-1">
            <Field label="Meta title" hint="Falls back to the name if blank">
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
                maxLength={320}
                onChange={(event) => {
                  update({ metaDescription: event.target.value });
                }}
              />
            </Field>
          </div>
        </Section>
      </fieldset>

      {mayWrite && (
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => void navigate({ to: '/products' })}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} iconLeft="check">
            {isEdit ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      )}
    </form>
  );
}

function VariantRow({
  variant,
  index,
  canRemove,
  onChange,
  onDefault,
  onRemove,
}: {
  variant: VariantForm;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<VariantForm>) => void;
  onDefault: () => void;
  onRemove: () => void;
}) {
  const defaultName = useId();
  return (
    <div className="rounded-lg border border-admin-border bg-admin-bg p-4">
      <div className="grid grid-cols-4 gap-3 tablet:grid-cols-2 mobile:grid-cols-1">
        <Field label="SKU" required>
          <Input
            value={variant.sku}
            onChange={(event) => {
              onChange({ sku: event.target.value });
            }}
          />
        </Field>
        <Field label="Label" required hint="What the customer reads">
          <Input
            value={variant.weightLabel}
            placeholder="2 lb"
            onChange={(event) => {
              onChange({ weightLabel: event.target.value });
            }}
          />
        </Field>
        <Field label="Weight value" required>
          <Input
            value={variant.weightValue}
            inputMode="decimal"
            placeholder="2"
            onChange={(event) => {
              onChange({ weightValue: event.target.value });
            }}
          />
        </Field>
        <Field label="Unit" required>
          <Select
            value={variant.weightUnit}
            options={WEIGHT_UNIT.map((unit) => ({ value: unit, label: unit }))}
            onChange={(event) => {
              onChange({ weightUnit: event.target.value as WeightUnit });
            }}
          />
        </Field>

        <Field label="Grams" hint="For range filters; blank for a kit">
          <Input
            value={variant.weightGrams}
            inputMode="numeric"
            onChange={(event) => {
              onChange({ weightGrams: event.target.value });
            }}
          />
        </Field>
        <Field label="Price ($)" required>
          <Input
            value={variant.price}
            inputMode="decimal"
            placeholder="12.00"
            onChange={(event) => {
              onChange({ price: event.target.value });
            }}
          />
        </Field>
        <Field label="Compare-at ($)" hint="The struck-through “was”">
          <Input
            value={variant.compareAt}
            inputMode="decimal"
            onChange={(event) => {
              onChange({ compareAt: event.target.value });
            }}
          />
        </Field>
        <Field label="Cost ($)" hint="Never shown to customers">
          <Input
            value={variant.cost}
            inputMode="decimal"
            onChange={(event) => {
              onChange({ cost: event.target.value });
            }}
          />
        </Field>

        <Field label="Stock" required>
          <Input
            value={variant.stock}
            inputMode="numeric"
            onChange={(event) => {
              onChange({ stock: event.target.value });
            }}
          />
        </Field>
        <Field label="Low-stock at" required>
          <Input
            value={variant.threshold}
            inputMode="numeric"
            onChange={(event) => {
              onChange({ threshold: event.target.value });
            }}
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-6">
        <label className="flex cursor-pointer items-center gap-2 text-bodySm text-body-muted">
          {/* A radio, not a checkbox: exactly one variant is the default, and a radio group is what
              "choose one" means to a keyboard and a screen reader both. */}
          <input
            type="radio"
            name={defaultName}
            checked={variant.isDefault}
            onChange={onDefault}
            className="h-4 w-4 accent-green"
          />
          Default variant
        </label>
        <Checkbox
          label="Active"
          checked={variant.isActive}
          onChange={(event) => {
            onChange({ isActive: event.target.checked });
          }}
        />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto inline-flex items-center gap-1.5 text-caption text-terracotta hover:underline"
          >
            <Icon name="trash" size={14} />
            Remove variant {String(index + 1)}
          </button>
        )}
      </div>
    </div>
  );
}

function NutritionPanel({
  panel,
  onChange,
  onRemove,
}: {
  panel: NutritionForm;
  onChange: (patch: Partial<NutritionForm>) => void;
  onRemove: () => void;
}) {
  const macro = (
    label: string,
    key: 'fat' | 'satFat' | 'carbs' | 'sugars' | 'fiber' | 'protein',
  ) => (
    <Field label={`${label} (g)`}>
      <Input
        value={panel[key]}
        inputMode="decimal"
        onChange={(event) => {
          onChange({ [key]: event.target.value });
        }}
      />
    </Field>
  );

  return (
    <div>
      <div className="grid grid-cols-3 gap-4 tablet:grid-cols-2 mobile:grid-cols-1">
        <Field label="Serving size" required hint="1/4 cup (45 g)">
          <Input
            value={panel.servingSize}
            onChange={(event) => {
              onChange({ servingSize: event.target.value });
            }}
          />
        </Field>
        <Field label="Servings per container">
          <Input
            value={panel.servingsPerContainer}
            inputMode="numeric"
            onChange={(event) => {
              onChange({ servingsPerContainer: event.target.value });
            }}
          />
        </Field>
        <Field label="Calories" required>
          <Input
            value={panel.calories}
            inputMode="numeric"
            onChange={(event) => {
              onChange({ calories: event.target.value });
            }}
          />
        </Field>

        {macro('Total fat', 'fat')}
        {macro('Saturated fat', 'satFat')}
        {/* Sodium is the one field in milligrams, because that is how a label prints it. */}
        <Field label="Sodium (mg)" required>
          <Input
            value={panel.sodium}
            inputMode="numeric"
            onChange={(event) => {
              onChange({ sodium: event.target.value });
            }}
          />
        </Field>
        {macro('Total carbohydrate', 'carbs')}
        {macro('Sugars', 'sugars')}
        {macro('Dietary fiber', 'fiber')}
        {macro('Protein', 'protein')}
      </div>

      <Field label="Ingredients" required className="mt-4">
        <Textarea
          rows={3}
          value={panel.ingredients}
          onChange={(event) => {
            onChange({ ingredients: event.target.value });
          }}
        />
      </Field>
      <Field label="Allergens" className="mt-4" hint="Contains: tree nuts…">
        <Input
          value={panel.allergens}
          onChange={(event) => {
            onChange({ allergens: event.target.value });
          }}
        />
      </Field>

      <button
        type="button"
        onClick={onRemove}
        className="mt-4 inline-flex items-center gap-1.5 text-caption text-terracotta hover:underline"
      >
        <Icon name="trash" size={14} />
        Remove the panel
      </button>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-admin-border bg-white p-6 shadow-card mobile:p-4">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h3 className="font-serif text-[18px] text-ink">{title}</h3>
        {note !== undefined && (
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-admin-muted">
            {note}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-pill px-4 py-2 text-bodySm transition-colors mobile:min-h-11 ${
        active
          ? 'border-[1.5px] border-green bg-sage-bg font-semibold text-green'
          : 'border border-admin-border bg-white text-body-muted hover:border-green'
      }`}
    >
      {active && <Icon name="check" weight="bold" size={12} />}
      {label}
    </button>
  );
}

// ------------------------------------------------------------------------ validation & payload

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The handful of checks worth catching before a round trip. The server holds the rest. */
function clientProblems(form: ProductState): string[] {
  const problems: string[] = [];
  if (form.name.trim().length < 2) problems.push('The product needs a name.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) {
    problems.push('The slug can only hold lowercase letters, digits and hyphens.');
  }
  if (form.categoryId === '') problems.push('Choose a category.');
  if (form.blurb.trim() === '')
    problems.push('The blurb is what the card shows; it cannot be empty.');
  if (form.description.trim() === '') problems.push('A product needs a description.');
  if (form.variants.filter((variant) => variant.isDefault).length !== 1) {
    problems.push('Exactly one variant has to be the default.');
  }
  form.variants.forEach((variant, index) => {
    if (variant.sku.trim() === '') problems.push(`Variant ${String(index + 1)} needs a SKU.`);
    if (dollarsToCents(variant.price) === null || dollarsToCents(variant.price) === 0) {
      problems.push(`Variant ${String(index + 1)} needs a price.`);
    }
  });
  if (form.nutrition !== null) {
    if (form.nutrition.servingSize.trim() === '')
      problems.push('The nutrition panel needs a serving size.');
    if (form.nutrition.ingredients.trim() === '')
      problems.push('The nutrition panel needs an ingredients list.');
  }
  return problems;
}

/** Builds the request body, or null if a money/weight field will not parse. */
function toPayload(form: ProductState): AdminProductInput | null {
  const variants = [];
  for (let index = 0; index < form.variants.length; index += 1) {
    const variant = form.variants[index];
    if (variant === undefined) continue;

    const price = dollarsToCents(variant.price);
    const weightValue = Number(variant.weightValue);
    if (price === null || !Number.isFinite(weightValue) || weightValue <= 0) return null;

    const grams = variant.weightGrams.trim() === '' ? null : toInt(variant.weightGrams);
    if (variant.weightGrams.trim() !== '' && grams === null) return null;

    const stock = toInt(variant.stock);
    const threshold = toInt(variant.threshold);
    if (stock === null || threshold === null) return null;

    variants.push({
      ...(variant.id === undefined ? {} : { id: variant.id }),
      sku: variant.sku.trim(),
      weightValueMilli: Math.round(weightValue * 1000),
      weightUnit: variant.weightUnit,
      weightLabel: variant.weightLabel.trim(),
      weightGrams: grams,
      priceCents: price,
      compareAtPriceCents: dollarsToCents(variant.compareAt),
      costCents: dollarsToCents(variant.cost),
      stockQty: stock,
      lowStockThreshold: threshold,
      position: index,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
    });
  }

  let nutrition: AdminProductInput['nutrition'] = null;
  if (form.nutrition !== null) {
    const panel = form.nutrition;
    // Each is `number | null`; a single null anywhere means a field would not parse, and the whole
    // save is abandoned rather than sent half-converted. Narrowed by hand, no assertions.
    const calories = toInt(panel.calories);
    const fatMg = gramsToMg(panel.fat);
    const satFatMg = gramsToMg(panel.satFat);
    const carbsMg = gramsToMg(panel.carbs);
    const sugarsMg = gramsToMg(panel.sugars);
    const fiberMg = gramsToMg(panel.fiber);
    const proteinMg = gramsToMg(panel.protein);
    const sodiumMg = toInt(panel.sodium);

    if (
      calories === null ||
      fatMg === null ||
      satFatMg === null ||
      carbsMg === null ||
      sugarsMg === null ||
      fiberMg === null ||
      proteinMg === null ||
      sodiumMg === null
    ) {
      return null;
    }

    nutrition = {
      servingSize: panel.servingSize.trim(),
      servingsPerContainer:
        panel.servingsPerContainer.trim() === '' ? null : toInt(panel.servingsPerContainer),
      calories,
      fatMg,
      satFatMg,
      carbsMg,
      sugarsMg,
      fiberMg,
      proteinMg,
      sodiumMg,
      ingredientsText: panel.ingredients.trim(),
      allergensText: panel.allergens.trim() === '' ? null : panel.allergens.trim(),
    };
  }

  return {
    name: form.name.trim(),
    slug: form.slug.trim(),
    subtitle: form.subtitle.trim() === '' ? null : form.subtitle.trim(),
    blurb: form.blurb.trim(),
    description: form.description.trim(),
    story: form.story.trim() === '' ? null : form.story.trim(),
    categoryId: Number(form.categoryId),
    origin: form.origin,
    originRegion: form.originRegion.trim() === '' ? null : form.originRegion.trim(),
    status: form.status,
    isFeatured: form.isFeatured,
    metaTitle: form.metaTitle.trim() === '' ? null : form.metaTitle.trim(),
    metaDescription: form.metaDescription.trim() === '' ? null : form.metaDescription.trim(),
    variants,
    certifications: form.certifications,
    badges: form.badges,
    nutrition,
  };
}

/** Turns a 422's field details or a 409's message into lines the banner can list. */
function serverMessages(cause: unknown): string[] {
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
