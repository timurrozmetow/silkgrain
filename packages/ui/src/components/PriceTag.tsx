import type { ReactElement } from 'react';

import { cn } from '../cn';

export interface PriceTagProps {
  /** Integer cents. Money never travels as a float. */
  cents: number;
  /**
   * Struck-through original price, when the item is on sale.
   * Explicitly `| undefined` because `exactOptionalPropertyTypes` is on and callers pass
   * an optional field straight through.
   */
  compareAtCents?: number | undefined;
  /** Prefixes a small "from" eyebrow, used wherever a product has several weights. */
  showFrom?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Suffix such as "per 5 lb". */
  unit?: string;
  className?: string;
}

const SIZES = {
  sm: 'text-[15px]',
  md: 'text-price',
  lg: 'text-priceLg',
} as const;

// Until Phase 2 lands Money.format(), this is the single place cents become a string.
// eslint-disable-next-line no-restricted-syntax -- see above
const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const format = (cents: number): string => formatter.format(cents / 100);

/**
 * Prices are always DM Mono and always green, per the mockup. Screen readers get the plain
 * amount rather than the struck-through/current pairing read as two prices in a row.
 */
export function PriceTag({
  cents,
  compareAtCents,
  showFrom = false,
  size = 'md',
  unit,
  className,
}: PriceTagProps): ReactElement {
  const onSale = compareAtCents !== undefined && compareAtCents > cents;

  return (
    <span className={cn('flex flex-col leading-none', className)}>
      {showFrom && (
        <span className="mb-1 text-microLabel uppercase tracking-[0.08em] text-label">from</span>
      )}
      <span className="flex items-baseline gap-2">
        <span className={cn('font-mono font-medium text-green', SIZES[size])}>{format(cents)}</span>
        {onSale && (
          <span className="font-mono text-[15px] text-muted-soft line-through">
            <span className="sr-only">Was </span>
            {format(compareAtCents)}
          </span>
        )}
        {unit && <span className="text-caption text-muted-soft">{unit}</span>}
      </span>
    </span>
  );
}
