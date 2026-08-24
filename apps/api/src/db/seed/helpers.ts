import type { Origin, WeightUnit } from '@silkgrain/contracts';

/**
 * A seeded pseudo-random generator, so two seed runs produce byte-identical data.
 *
 * `Math.random` would make every reseed a different catalogue, which turns any diff of the
 * database into noise and makes a failing test impossible to reproduce.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function pickInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

const GRAMS_PER: Record<Exclude<WeightUnit, 'kit'>, number> = {
  lb: 453.592_37,
  oz: 28.349_523_125,
  g: 1,
};

export interface ParsedWeight {
  /** The authored value times 1000, as an integer. `2 lb` is 2000. */
  valueMilli: number;
  unit: WeightUnit;
  label: string;
  /** Null for `kit`, which is a count rather than a weight. */
  grams: number | null;
}

/** Reads the designer's weight labels: `2 lb`, `8 oz`, `1 g`, `1 kit`. */
export function parseWeightLabel(label: string): ParsedWeight {
  const match = /^(\d+(?:\.\d+)?)\s*(lb|oz|g|kit)$/.exec(label.trim());
  if (!match) throw new Error(`Cannot read the weight label "${label}"`);

  const [, rawValue = '0', rawUnit = 'g'] = match;
  const unit = rawUnit as WeightUnit;
  const value = Number(rawValue);

  return {
    valueMilli: Math.round(value * 1000),
    unit,
    label: label.trim(),
    grams: unit === 'kit' ? null : Math.round(value * GRAMS_PER[unit]),
  };
}

const ORIGIN_BY_COUNTRY: Record<string, Origin> = {
  Uzbekistan: 'UZ',
  Kazakhstan: 'KZ',
  Turkmenistan: 'TM',
  Kyrgyzstan: 'KG',
  Tajikistan: 'TJ',
  'Mixed Origin': 'MIXED',
};

export function originCode(country: string): Origin {
  const code = ORIGIN_BY_COUNTRY[country];
  if (!code) throw new Error(`No origin code for "${country}". Add it to ORIGIN_BY_COUNTRY.`);
  return code;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `SG-014-5LB`. Sequential rather than derived from the name, so a product rename does not
 * change the SKU printed on a packing slip that already went out.
 */
export function makeSku(productIndex: number, weightLabel: string): string {
  const suffix = weightLabel.replace(/\s+/g, '').toUpperCase();
  return `SG-${String(productIndex + 1).padStart(3, '0')}-${suffix}`;
}

/** `Jun 25` in the mockup's admin tables. The order numbers put those dates in 2025. */
export function parseDesignDate(label: string, year = 2025): Date {
  const parsed = new Date(`${label} ${String(year)} 12:00:00 UTC`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Cannot read the date "${label}"`);
  return parsed;
}

export function emailFromName(name: string): string {
  return `${slugify(name).replace(/-/g, '.')}@example.com`;
}
