import { useId, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

import { cn } from '../cn';

export interface TabItem {
  id: string;
  label: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Names the tab list for assistive tech, e.g. "Product details". */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * Tabs following the ARIA authoring practice: arrow keys move between tabs, Home and End
 * jump to the ends, and only the selected tab is in the tab order.
 *
 * The key handler sits on the tabs themselves rather than on the tablist, because the
 * tablist is not focusable and would never receive the event.
 */
export function Tabs({
  items,
  value,
  onChange,
  label,
  children,
  className,
}: TabsProps): ReactElement {
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const index = items.findIndex((item) => item.id === value);
    if (index < 0) return;

    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next === null) return;

    const target = items[next];
    if (!target) return;

    event.preventDefault();
    onChange(target.id);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${base}-tab-${target.id}`)}`)
      ?.focus();
  };

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className="flex gap-7 overflow-x-auto border-b border-line-warm"
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              id={`${base}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onKeyDown={onKeyDown}
              onClick={() => {
                onChange(item.id);
              }}
              className={cn(
                'whitespace-nowrap border-b-2 px-1 py-3.5 text-bodySm font-semibold',
                'transition-colors duration-fast',
                selected
                  ? 'border-green text-green'
                  : 'border-transparent text-muted-soft hover:text-body',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          id={`${base}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${item.id}`}
          hidden={item.id !== value}
          // The authoring practice makes the panel focusable so keyboard users can reach
          // content that holds no controls of its own; the lint rule does not model that.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="pt-7 focus-visible:outline-none"
        >
          {item.id === value && children}
        </div>
      ))}
    </div>
  );
}
