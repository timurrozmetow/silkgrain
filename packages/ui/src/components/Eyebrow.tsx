import type { ElementType, ReactElement, ReactNode } from 'react';

import { cn } from '../cn';

import { Diamond } from './Diamond';

export interface EyebrowProps {
  children: ReactNode;
  /**
   * `diamond` prefixes the gold rhombus, `rule` prefixes the 36px gold hairline used beside
   * the homepage hero, `none` leaves the label bare.
   */
  marker?: 'diamond' | 'rule' | 'none';
  /** `wide` is the 0.26em tracking used on the hero and the subscribe section. */
  tracking?: 'normal' | 'wide';
  /** Eyebrows sit on dark panels too, where they switch from goldDark to gold. */
  tone?: 'light' | 'dark';
  as?: ElementType;
  className?: string;
}

/**
 * The small uppercase label that opens almost every section: DM Mono, wide tracking,
 * `goldDark` on light surfaces and `gold` on dark ones.
 */
export function Eyebrow({
  children,
  marker = 'diamond',
  tracking = 'normal',
  tone = 'light',
  as: Tag = 'span',
  className,
}: EyebrowProps): ReactElement {
  return (
    <span className={cn('flex items-center gap-3', className)}>
      {marker === 'diamond' && <Diamond />}
      {marker === 'rule' && <span aria-hidden="true" className="h-px w-9 shrink-0 bg-gold" />}
      <Tag
        className={cn(
          'font-mono uppercase',
          tracking === 'wide' ? 'text-eyebrowWide' : 'text-eyebrow',
          tone === 'dark' ? 'text-gold' : 'text-gold-dark',
        )}
      >
        {children}
      </Tag>
    </span>
  );
}
