import type { ElementType, ReactElement, ReactNode } from 'react';

import { cn } from '../cn';

export interface CardProps {
  children: ReactNode;
  /**
   * `surface` is the standard cream card, `panel` the heavier sticky summary used by the
   * cart and checkout, `deep` the dark green panel from the subscribe and referral blocks.
   */
  variant?: 'surface' | 'panel' | 'deep' | 'admin';
  /** Adds the lift-and-shadow hover from the product and recipe cards. */
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  as?: ElementType;
  className?: string;
}

const VARIANTS = {
  surface: 'bg-surface border border-line-soft shadow-card',
  panel: 'bg-surface border border-line-warm shadow-panel',
  deep: 'bg-green-deep border border-transparent text-ondeep',
  admin: 'bg-white border border-admin-border shadow-card',
} as const;

const PADDING = {
  none: '',
  sm: 'p-5',
  md: 'p-7',
  lg: 'p-10',
} as const;

export function Card({
  children,
  variant = 'surface',
  interactive = false,
  padding = 'md',
  as: Tag = 'div',
  className,
}: CardProps): ReactElement {
  return (
    <Tag
      className={cn(
        'rounded-lg',
        VARIANTS[variant],
        PADDING[padding],
        interactive &&
          'cursor-pointer transition-[transform,box-shadow,border-color] duration-slow ease-standard hover:-translate-y-1.5 hover:border-[#D9CBA8] hover:shadow-cardHover',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
