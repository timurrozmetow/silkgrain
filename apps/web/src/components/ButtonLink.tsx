import {
  Icon,
  type ButtonClassOptions,
  type IconName,
  buttonClasses,
  buttonContentGap,
  buttonIconSize,
} from '@silkgrain/ui';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/**
 * A call to action that navigates.
 *
 * An anchor, wearing the button's own classes from `@silkgrain/ui`. A `<button>` with an
 * `onClick` that navigates would look identical and behave worse: no middle-click to open in
 * a tab, no right-click menu, no destination in the status bar, and nothing for a crawler to
 * follow.
 *
 * Icons come from the same `SIZES` table `Button` reads, through `buttonIconSize` and
 * `buttonContentGap`, so a link and a button of the same size are indistinguishable.
 */
export type ButtonLinkProps = LinkProps &
  ButtonClassOptions & {
    children: ReactNode;
    /** Phosphor icon name rendered before the label, as `Button` does. */
    iconLeft?: IconName;
    /** Phosphor icon name rendered after the label. */
    iconRight?: IconName;
    'aria-label'?: string;
    /** For a link inside a panel that has to close itself on the way out. */
    onClick?: () => void;
  };

export function ButtonLink({
  variant,
  size,
  corner,
  fullWidth,
  className,
  iconLeft,
  iconRight,
  children,
  ...link
}: ButtonLinkProps) {
  const iconSize = buttonIconSize(size);
  // The gap only matters when there is an icon to space away from the label.
  const hasIcon = iconLeft !== undefined || iconRight !== undefined;
  const classes = [hasIcon ? buttonContentGap(size) : undefined, className]
    .filter((entry): entry is string => entry !== undefined && entry !== '')
    .join(' ');

  return (
    <Link
      {...link}
      className={buttonClasses({
        ...(variant === undefined ? {} : { variant }),
        ...(size === undefined ? {} : { size }),
        ...(corner === undefined ? {} : { corner }),
        ...(fullWidth === undefined ? {} : { fullWidth }),
        ...(classes === '' ? {} : { className: classes }),
      })}
    >
      {iconLeft && <Icon name={iconLeft} size={iconSize} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </Link>
  );
}
