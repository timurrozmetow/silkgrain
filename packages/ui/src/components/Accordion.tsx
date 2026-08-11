import { useId, type ReactElement, type ReactNode } from 'react';

import { cn } from '../cn';

import { Icon } from './Icon';

export interface AccordionItemProps {
  question: ReactNode;
  answer: ReactNode;
  open: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * One FAQ row: a card whose whole header is the toggle button.
 *
 * The panel stays in the DOM and is hidden with `hidden`, so in-page search and
 * `aria-controls` both resolve to a real element.
 */
export function AccordionItem({
  question,
  answer,
  open,
  onToggle,
  className,
}: AccordionItemProps): ReactElement {
  const base = useId();
  const panelId = `${base}-panel`;
  const buttonId = `${base}-button`;

  return (
    <div
      className={cn(
        'rounded-lg border border-line-warm bg-surface px-6 py-5 transition-colors duration-base',
        open ? 'border-gold' : 'hover:border-gold',
        className,
      )}
    >
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          // The row is 30px tall inside the item's padding, which a cursor hits easily and a
          // thumb does not. 44px on mobile, per the responsive handoff.
          className="flex w-full items-center gap-4 text-left mobile:min-h-11"
        >
          <span className="flex-1 text-[16.5px] font-semibold text-ink">{question}</span>
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-pill bg-[#EBEAE1] text-green">
            <Icon name={open ? 'minus' : 'plus'} size={16} />
          </span>
        </button>
      </h3>

      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!open}>
        <p className="mt-3.5 text-[15px] leading-[1.65] text-muted">{answer}</p>
      </div>
    </div>
  );
}

export interface AccordionProps {
  children: ReactNode;
  className?: string;
}

export function Accordion({ children, className }: AccordionProps): ReactElement {
  return <div className={cn('flex flex-col gap-3', className)}>{children}</div>;
}
