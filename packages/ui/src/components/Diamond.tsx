import type { ReactElement } from 'react';

import { cn } from '../cn';

export interface DiamondProps {
  /** Matches the mockup's two sizes: 6px in the announcement bar, 7px in section eyebrows. */
  size?: 6 | 7;
  className?: string;
}

/**
 * The gold rhombus that separates eyebrow text throughout the design - a square rotated 45
 * degrees, not a glyph, so it stays crisp at any zoom and needs no icon font.
 *
 * Purely decorative, so it is hidden from assistive technology.
 */
export function Diamond({ size = 7, className }: DiamondProps): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 rotate-45 bg-gold', className)}
      style={{ width: `${String(size)}px`, height: `${String(size)}px` }}
    />
  );
}
