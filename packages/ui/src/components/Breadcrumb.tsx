import type { ReactElement, ReactNode } from 'react';

import { cn } from '../cn';

import { Icon } from './Icon';

export interface Crumb {
  label: ReactNode;
  /** Omitted on the final crumb, which is the current page. */
  href?: string;
  onClick?: () => void;
}

export interface BreadcrumbProps {
  items: readonly Crumb[];
  /** `light` sits on parchment, `dark` on the category hero image. */
  tone?: 'light' | 'dark';
  className?: string;
}

/**
 * Breadcrumb trail.
 *
 * The last item is the current page: it is rendered as plain text with `aria-current`
 * rather than a link that goes nowhere.
 */
export function Breadcrumb({ items, tone = 'light', className }: BreadcrumbProps): ReactElement {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex items-center gap-2.5 text-caption">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="flex items-center gap-2.5">
              {isLast ? (
                <span
                  aria-current="page"
                  className={cn('font-semibold', tone === 'dark' ? 'text-gold' : 'text-body')}
                >
                  {item.label}
                </span>
              ) : (
                <>
                  <a
                    href={item.href}
                    onClick={item.onClick}
                    className={cn(
                      'transition-colors duration-base',
                      tone === 'dark'
                        ? 'text-ondeep-soft hover:text-white'
                        : 'text-muted-soft hover:text-green',
                    )}
                  >
                    {item.label}
                  </a>
                  <Icon
                    name="caret-right"
                    size={12}
                    className={tone === 'dark' ? 'text-ondeep-soft' : 'text-muted-soft'}
                  />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
