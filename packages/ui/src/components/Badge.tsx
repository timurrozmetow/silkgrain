import type { ReactElement, ReactNode } from 'react';

import { cn } from '../cn';

/** Product badges, exactly the set the mockup defines. */
export type BadgeTone = 'bestseller' | 'new' | 'sale' | 'organic' | 'premium';

/** Status chips used by the admin and the account order history. */
export type ChipTone = 'positive' | 'warning' | 'negative' | 'neutral' | 'info';

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
}

const BADGE_TONES: Record<BadgeTone, string> = {
  // Gold carries greenDeep, never white: white on gold is 2.2:1.
  bestseller: 'bg-gold text-green-deep',
  new: 'bg-green text-white',
  sale: 'bg-terracotta text-white',
  organic: 'bg-green-muted text-white',
  premium: 'bg-gold-dark text-white',
};

/** The corner badge on a product image. */
export function Badge({ tone, children, className }: BadgeProps): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-2 py-1',
        'text-microLabel font-semibold uppercase tracking-[0.08em]',
        'shadow-[0_2px_6px_rgba(0,0,0,0.14)]',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface StatusChipProps {
  tone: ChipTone;
  children: ReactNode;
  /** The mockup pairs most chips with a small filled dot. */
  dot?: boolean;
  className?: string;
}

const CHIP_TONES: Record<ChipTone, { chip: string; dot: string }> = {
  positive: { chip: 'bg-sage-bg text-green-muted', dot: 'bg-green-muted' },
  warning: { chip: 'bg-gold-bg text-gold-dark', dot: 'bg-gold-dark' },
  negative: { chip: 'bg-terracotta-bg text-terracotta', dot: 'bg-terracotta' },
  neutral: { chip: 'bg-neutralChip text-muted', dot: 'bg-muted' },
  info: { chip: 'bg-sage-bg text-green', dot: 'bg-green' },
};

/** The pill used for order status, stock state and wholesale pipeline stage. */
export function StatusChip({
  tone,
  children,
  dot = true,
  className,
}: StatusChipProps): ReactElement {
  const styles = CHIP_TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-3 py-1',
        'text-[12px] font-semibold leading-none',
        styles.chip,
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-pill', styles.dot)} />}
      {children}
    </span>
  );
}
