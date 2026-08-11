import type { ReactElement } from 'react';

import { cn } from '../cn';

import { Icon } from './Icon';

export interface PaginationProps {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  className?: string;
}

/** Page numbers around the current page, with ellipses where the run is broken. */
function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const pages = new Set<number>([1, pageCount, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);

  const result: (number | 'gap')[] = [];
  let previous = 0;
  for (const current of sorted) {
    if (previous && current - previous > 1) result.push('gap');
    result.push(current);
    previous = current;
  }
  return result;
}

export function Pagination({
  page,
  pageCount,
  onChange,
  className,
}: PaginationProps): ReactElement {
  const items = pageWindow(page, pageCount);

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center justify-center gap-2', className)}
    >
      {items.map((item, index) =>
        item === 'gap' ? (
          <span key={`gap-${String(index)}`} aria-hidden="true" className="px-1 text-muted-soft">
            &hellip;
          </span>
        ) : (
          <button
            key={item}
            type="button"
            aria-label={`Page ${String(item)}`}
            aria-current={item === page ? 'page' : undefined}
            onClick={() => {
              onChange(item);
            }}
            className={cn(
              // 44px on mobile: page numbers sit close together and are hit with a thumb.
              'flex h-10 w-10 items-center justify-center rounded-md font-mono text-bodySm',
              'mobile:h-11 mobile:w-11',
              'transition-colors duration-fast',
              item === page
                ? 'bg-green text-white'
                : 'border border-line bg-surface text-body hover:border-green hover:text-green',
            )}
          >
            {item}
          </button>
        ),
      )}

      {page < pageCount && (
        <button
          type="button"
          onClick={() => {
            onChange(page + 1);
          }}
          className="flex h-10 items-center gap-1.5 rounded-md border border-line bg-surface px-4 text-bodySm text-body transition-colors duration-fast hover:border-green hover:text-green mobile:h-11"
        >
          Next
          <Icon name="arrow-right" size={15} />
        </button>
      )}
    </nav>
  );
}
