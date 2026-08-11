import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../cn';

import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'outline' | 'light' | 'goldOutline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * The mockup uses two corner radii for the same button: 6px in the header and on cards,
   * 3px in the hero, the drawer and the bundle CTA.
   */
  corner?: 'md' | 'sharp';
  fullWidth?: boolean;
  loading?: boolean;
  /** Phosphor icon name rendered before the label. */
  iconLeft?: IconName;
  /** Phosphor icon name rendered after the label. */
  iconRight?: IconName;
  children?: ReactNode;
  className?: string;
}

const VARIANTS: Record<ButtonVariant, string> = {
  // Solid green on light surfaces. White on #0E6B4A is 6.5:1.
  primary: 'bg-green text-white border border-transparent hover:bg-green-hover',
  // Green hairline on light surfaces.
  outline: 'bg-transparent text-green border border-green hover:bg-sage-bg',
  // Cream fill for photography and dark panels; the label is ink, never white.
  light:
    'bg-surface-warm text-ink border border-transparent shadow-panel hover:-translate-y-0.5 hover:shadow-cardHover',
  // Gold hairline on the dark wholesale banner. Inverts to greenDeep on gold, never white.
  goldOutline:
    'bg-transparent text-gold border-[1.5px] border-gold hover:bg-gold hover:text-green-deep',
  // Text-only affordance.
  ghost: 'bg-transparent text-green border border-transparent hover:bg-sage-bg',
  // Destructive: remove, cancel, decline.
  danger: 'bg-terracotta text-white border border-transparent hover:brightness-110',
};

/**
 * `sm` grows to 44px on mobile, which is the responsive handoff's touch-target floor.
 *
 * Only `sm` needs it - `md` is already 44 and `lg` is 52. Done here rather than at the call
 * sites because a small button is small wherever it appears, and hunting them down one at a
 * time is how three of them stay 36px until somebody complains.
 */
const SIZES: Record<ButtonSize, { frame: string; gap: string; icon: number }> = {
  sm: { frame: 'h-9 px-4 text-caption mobile:h-11', gap: 'gap-2', icon: 15 },
  md: { frame: 'h-11 px-5 text-bodySm', gap: 'gap-2', icon: 16 },
  lg: { frame: 'h-[52px] px-7 text-body', gap: 'gap-2.5', icon: 18 },
};

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  corner?: 'md' | 'sharp';
  fullWidth?: boolean;
  className?: string;
}

/**
 * The button's appearance, without the button.
 *
 * A call to action that navigates has to be an anchor: wrapping a `<button>` in a link is
 * invalid, and a `<button>` with an `onClick` that navigates loses the middle-click, the
 * right-click menu and the status bar. Exporting the classes lets a router `Link` look
 * exactly like a `Button` without either of them growing a polymorphic `as` prop, and keeps
 * one definition of what a primary button looks like.
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  corner = 'md',
  fullWidth = false,
  className,
}: ButtonClassOptions = {}): string {
  return cn(
    'relative inline-flex items-center justify-center font-sans font-semibold',
    'transition-[background-color,color,transform,box-shadow] duration-base ease-standard',
    'disabled:pointer-events-none disabled:opacity-40',
    corner === 'sharp' ? 'rounded-sharp' : 'rounded-md',
    fullWidth && 'w-full',
    SIZES[size].frame,
    VARIANTS[variant],
    className,
  );
}

/** The icon size that goes with a button size, for a link that wants one. */
export function buttonIconSize(size: ButtonSize = 'md'): number {
  return SIZES[size].icon;
}

/**
 * The gap between a button's icon and its label.
 *
 * Exported beside `buttonIconSize` so a link rendering the same pair reads both from `SIZES`
 * rather than restating `gap-2` and drifting the day a size changes.
 */
export function buttonContentGap(size: ButtonSize = 'md'): string {
  return SIZES[size].gap;
}

/**
 * The one button in the system.
 *
 * While `loading`, the label stays mounted but invisible so the button keeps its width, and
 * `aria-busy` reports the state instead of a spinner replacing the control and stealing focus.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    corner = 'md',
    fullWidth = false,
    loading = false,
    disabled = false,
    iconLeft,
    iconRight,
    children,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const sizing = SIZES[size];

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({
        variant,
        size,
        corner,
        fullWidth,
        ...(className === undefined ? {} : { className }),
      })}
      {...rest}
    >
      <span className={cn('inline-flex items-center', sizing.gap, loading && 'invisible')}>
        {iconLeft && <Icon name={iconLeft} size={sizing.icon} />}
        {children}
        {iconRight && <Icon name={iconRight} size={sizing.icon} />}
      </span>

      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Icon name="circle-notch" size={sizing.icon} className="animate-spin" />
        </span>
      )}
    </button>
  );
});
