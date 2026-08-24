import type { ProductFacets } from '@silkgrain/contracts';
import { Checkbox, Icon } from '@silkgrain/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { PriceRange } from './PriceRange';

/**
 * The shop's filters.
 *
 * Every list here is drawn from `facets`, which the server computes with each facet's own
 * filter removed (decision D-21). That is what makes ticking a box safe: the other counts
 * still describe what is reachable, a value that currently matches nothing stays in the list
 * at zero rather than vanishing, and the price track does not shrink under its own handles.
 *
 * Nothing is hard-coded. The mockup lists weights as 1/2/5/10/25/50 lb, which is not this
 * catalogue's set, and a list written in the markup would be wrong the first time a variant
 * was added.
 */

const ORIGIN_LABELS: Record<string, string> = {
  UZ: 'Uzbekistan',
  KZ: 'Kazakhstan',
  TM: 'Turkmenistan',
  KG: 'Kyrgyzstan',
  TJ: 'Tajikistan',
  MIXED: 'Mixed origin',
};

const CERTIFICATION_LABELS: Record<string, string> = {
  organic: 'Organic',
  non_gmo: 'Non-GMO',
  halal: 'Halal',
  kosher: 'Kosher',
  gluten_free: 'Gluten free',
};

export interface FilterValues {
  category?: string;
  origin?: string;
  cert?: string;
  weight?: string;
  priceMinCents?: number;
  priceMaxCents?: number;
  inStock?: boolean;
}

/**
 * A change to apply. Explicitly allows `undefined` under `exactOptionalPropertyTypes`,
 * because "clear this filter" is a value the sidebar has to be able to send.
 */
export type FilterPatch = { [K in keyof FilterValues]?: FilterValues[K] | undefined };

export interface FilterSidebarProps {
  facets: ProductFacets | undefined;
  values: FilterValues;
  onChange: (next: FilterPatch) => void;
  /** True when anything is set, which is what makes Reset worth showing. */
  active: boolean;
}

/** Comma-separated in the URL, a set in the head. */
function toSet(value: string | undefined): Set<string> {
  return new Set(value === undefined || value.length === 0 ? [] : value.split(','));
}

function toggle(value: string | undefined, entry: string): string | undefined {
  const set = toSet(value);
  if (set.has(entry)) set.delete(entry);
  else set.add(entry);
  return set.size === 0 ? undefined : [...set].join(',');
}

export function FilterSidebar({ facets, values, onChange, active }: FilterSidebarProps) {
  // Collapsed by default below the tablet breakpoint, where the sidebar stops being a column
  // and a wall of checkboxes would push the products off the screen.
  const [open, setOpen] = useState(false);

  return (
    <aside className="w-[260px] shrink-0 tablet:w-full">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-[21px] text-ink">Filters</h2>
        <div className="flex items-center gap-4">
          {active && (
            <Link to="/shop" className="text-[13px] text-terracotta underline underline-offset-4">
              Reset
            </Link>
          )}
          <button
            type="button"
            className="hidden min-h-[44px] items-center gap-2 text-[13px] text-green tablet:flex"
            aria-expanded={open}
            onClick={() => {
              setOpen((current) => !current);
            }}
          >
            {open ? 'Hide' : 'Show'}
            <Icon name={open ? 'caret-down' : 'caret-right'} size={14} />
          </button>
        </div>
      </div>

      <div
        className={`sticky top-[90px] mt-5 space-y-4 tablet:static ${open ? '' : 'tablet:hidden'}`}
      >
        <FacetCard title="Categories">
          {(facets?.categories ?? []).map((facet) => (
            <FacetCheckbox
              key={facet.slug}
              label={facet.name}
              count={facet.count}
              checked={toSet(values.category).has(facet.slug)}
              onToggle={() => {
                onChange({ category: toggle(values.category, facet.slug) });
              }}
            />
          ))}
        </FacetCard>

        {facets !== undefined && facets.price.maxCents > facets.price.minCents && (
          <FacetCard title="Price range">
            <PriceRange
              minCents={facets.price.minCents}
              maxCents={facets.price.maxCents}
              valueMin={values.priceMinCents}
              valueMax={values.priceMaxCents}
              onCommit={(next) => {
                onChange({ priceMinCents: next.min, priceMaxCents: next.max });
              }}
            />
          </FacetCard>
        )}

        <FacetCard title="Weight">
          {(facets?.weights ?? []).map((facet) => (
            <FacetCheckbox
              key={facet.label}
              label={facet.label}
              count={facet.count}
              checked={toSet(values.weight).has(facet.label)}
              onToggle={() => {
                onChange({ weight: toggle(values.weight, facet.label) });
              }}
            />
          ))}
        </FacetCard>

        <FacetCard title="Origin">
          {(facets?.origins ?? []).map((facet) => (
            <FacetCheckbox
              key={facet.value}
              label={ORIGIN_LABELS[facet.value] ?? facet.value}
              count={facet.count}
              checked={toSet(values.origin).has(facet.value)}
              onToggle={() => {
                onChange({ origin: toggle(values.origin, facet.value) });
              }}
            />
          ))}
        </FacetCard>

        <FacetCard title="Certifications">
          {(facets?.certifications ?? []).map((facet) => (
            <FacetCheckbox
              key={facet.value}
              label={CERTIFICATION_LABELS[facet.value] ?? facet.value}
              count={facet.count}
              checked={toSet(values.cert).has(facet.value)}
              onToggle={() => {
                onChange({ cert: toggle(values.cert, facet.value) });
              }}
            />
          ))}
        </FacetCard>

        <FacetCard title="Availability">
          <Checkbox
            label="In stock only"
            checked={values.inStock === true}
            onChange={(event) => {
              onChange({ inStock: event.target.checked ? true : undefined });
            }}
          />
        </FacetCard>
      </div>
    </aside>
  );
}

function FacetCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-line bg-surface p-5">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{title}</h3>
      <div className="mt-4 space-y-2.5">{children}</div>
    </section>
  );
}

function FacetCheckbox({
  label,
  count,
  checked,
  onToggle,
}: {
  label: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Checkbox
        label={label}
        checked={checked}
        // A zero-count box is left enabled when it is ticked, so it can always be un-ticked.
        disabled={count === 0 && !checked}
        onChange={onToggle}
      />
      <span className="shrink-0 font-mono text-[11px] text-muted">{count}</span>
    </div>
  );
}
