import type { ReactElement } from 'react';

import { cn } from '../cn';

import { Icon } from './Icon';

export interface SpinnerProps {
  size?: number;
  /** Announced to a screen reader and used as the tooltip. */
  label?: string;
  className?: string;
}

/**
 * The one spinner.
 *
 * It was inlined in three places before this existed - `Icon name="circle-notch"` with
 * `animate-spin` and no accessible name anywhere - which meant a screen reader announced nothing
 * at all while a page was loading. `role="status"` with a live region is what turns a rotating
 * shape into "Loading" for somebody who cannot see it rotate.
 *
 * `motion-reduce:animate-none` is not decoration: a rotating element is one of the patterns that
 * triggers vestibular symptoms, and the operating system already knows who has asked not to see
 * one. The shape stays, so the page still shows something is happening.
 */
export function Spinner({ size = 24, label = 'Loading', className }: SpinnerProps): ReactElement {
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex', className)}>
      <Icon name="circle-notch" size={size} className="animate-spin motion-reduce:animate-none" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * A whole page waiting for its code to arrive.
 *
 * The height is the point. A router's pending component replaces the route's content, so one that
 * is only as tall as a spinner collapses the page to nothing and pushes the footer up the screen -
 * then drops it back when the chunk lands. That is a layout shift the score notices and a reader
 * notices more (decision D-43: a placeholder is a promise about height). 60vh is roughly what an
 * article-shaped page occupies above the fold.
 */
export function PageLoader({ label = 'Loading' }: { label?: string }): ReactElement {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner size={30} label={label} className="text-green" />
    </div>
  );
}
