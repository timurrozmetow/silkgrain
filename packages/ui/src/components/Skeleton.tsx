import type { CSSProperties, ReactElement } from 'react';

import { cn } from '../cn';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  shape?: 'line' | 'block' | 'circle';
  className?: string;
  style?: CSSProperties;
}

/**
 * Loading placeholder using the mockup's `sgShimmer` sweep.
 *
 * Hidden from assistive technology: a screen reader should hear the loading state announced
 * once by the region that owns it, not a stack of empty boxes.
 */
export function Skeleton({
  width,
  height,
  shape = 'line',
  className,
  style,
}: SkeletonProps): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block animate-shimmer',
        'bg-[linear-gradient(90deg,#EFEAE0_0%,#F7F3EA_50%,#EFEAE0_100%)] bg-[length:560px_100%]',
        shape === 'circle' && 'rounded-pill',
        shape === 'line' && 'h-[1em] rounded-sm',
        shape === 'block' && 'rounded-lg',
        className,
      )}
      style={{ width, height, ...style }}
    />
  );
}
