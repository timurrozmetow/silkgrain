import type { ReactElement, ReactNode } from 'react';

import { cn } from '../cn';

import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  /** Phosphor icon name for the 78px circle. */
  icon: IconName;
  title: string;
  description?: ReactNode;
  /** Usually a Button. */
  action?: ReactNode;
  /** `gold` is the empty-cart circle, `green` the no-results one. */
  tone?: 'gold' | 'green';
  className?: string;
}

const TONES = {
  gold: 'bg-gold-pale text-gold-dark',
  green: 'bg-sage-bg text-green',
} as const;

/**
 * The empty state pattern from the mockup: icon in a soft circle, serif heading, one line
 * of copy, one action. Used for empty cart, empty wishlist, no search results, no orders
 * and no wholesale requests.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'gold',
  className,
}: EmptyStateProps): ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-4 rounded-xl border border-line-warm bg-surface px-8 py-10 text-center shadow-card',
        className,
      )}
    >
      <span
        className={cn(
          'flex h-[78px] w-[78px] items-center justify-center rounded-pill',
          TONES[tone],
        )}
      >
        <Icon name={icon} size={38} />
      </span>
      <h3 className="font-display text-h3 font-semibold text-ink">{title}</h3>
      {description && <p className="max-w-[280px] text-bodySm text-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
