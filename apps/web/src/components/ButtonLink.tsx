import { type ButtonClassOptions, buttonClasses } from '@silkgrain/ui';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/**
 * A call to action that navigates.
 *
 * An anchor, wearing the button's own classes from `@silkgrain/ui`. A `<button>` with an
 * `onClick` that navigates would look identical and behave worse: no middle-click to open in
 * a tab, no right-click menu, no destination in the status bar, and nothing for a crawler to
 * follow.
 */
export type ButtonLinkProps = LinkProps &
  ButtonClassOptions & {
    children: ReactNode;
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
  children,
  ...link
}: ButtonLinkProps) {
  return (
    <Link
      {...link}
      className={buttonClasses({
        ...(variant === undefined ? {} : { variant }),
        ...(size === undefined ? {} : { size }),
        ...(corner === undefined ? {} : { corner }),
        ...(fullWidth === undefined ? {} : { fullWidth }),
        ...(className === undefined ? {} : { className }),
      })}
    >
      {children}
    </Link>
  );
}
