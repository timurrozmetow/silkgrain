import type { ReactElement } from 'react';

import { cn } from '../cn';

import { Icon } from './Icon';

export interface StarRatingProps {
  /** 0 to 5, may be fractional. */
  value: number;
  reviewCount?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Hides the numeric value, for tight layouts such as the product card. */
  compact?: boolean;
  className?: string;
}

const GLYPH_SIZE = { sm: 13, md: 16, lg: 18 } as const;

/**
 * Star ratings.
 *
 * The stars are gold, which is below the 3:1 threshold on light surfaces - so they are
 * marked decorative and the rating is always also present as text. That keeps the
 * information available without darkening the brand accent.
 */
export function StarRating({
  value,
  reviewCount,
  size = 'md',
  compact = false,
  className,
}: StarRatingProps): ReactElement {
  const rounded = Math.round(value);
  const label =
    reviewCount === undefined
      ? `Rated ${value.toFixed(1)} out of 5`
      : `Rated ${value.toFixed(1)} out of 5 from ${String(reviewCount)} reviews`;

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span aria-hidden="true" className="flex gap-0.5 text-gold">
        {[1, 2, 3, 4, 5].map((position) => (
          <Icon
            key={position}
            name="star"
            weight={position <= rounded ? 'fill' : 'regular'}
            size={GLYPH_SIZE[size]}
          />
        ))}
      </span>
      <span className="sr-only">{label}</span>
      {!compact && (
        <>
          <span aria-hidden="true" className="font-mono text-caption text-body">
            {value.toFixed(1)}
          </span>
          {reviewCount !== undefined && (
            <span aria-hidden="true" className="text-caption text-muted-soft">
              ({reviewCount})
            </span>
          )}
        </>
      )}
    </span>
  );
}
