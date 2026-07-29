import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../cn';

import { Icon } from './Icon';

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className'
> {
  label: ReactNode;
  /** Right-aligned count, as used by the catalog category filters. */
  count?: number;
  className?: string;
}

/**
 * Checkbox.
 *
 * The real input stays in the DOM and is only visually hidden, so keyboard focus, form
 * submission and screen-reader semantics behave natively. The 18px box is a sibling of the
 * input, which is what lets `peer-checked` reach it - and `[&_svg]` reaches the tick inside.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, count, className, disabled, ...rest },
  ref,
) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 text-bodySm text-body-muted',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input ref={ref} type="checkbox" disabled={disabled} className="peer sr-only" {...rest} />
      <span
        aria-hidden="true"
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm border',
          'border-[#C9BFA9] bg-white text-white transition-colors duration-fast',
          'peer-checked:border-green peer-checked:bg-green',
          'peer-checked:[&_svg]:opacity-100',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-green',
        )}
      >
        <Icon name="check" weight="bold" size={12} className="opacity-0" />
      </span>
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="font-mono text-caption text-label">{count}</span>}
    </label>
  );
});
