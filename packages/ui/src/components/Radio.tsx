import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../cn';

export interface RadioProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className'
> {
  label: ReactNode;
  /** Secondary line, e.g. "3-5 business days". */
  description?: ReactNode;
  /** Right-aligned value, e.g. "FREE" or "$12.99". */
  trailing?: ReactNode;
  /**
   * `card` is the bordered shipping-method row from the checkout; `inline` is a plain
   * radio with a label.
   */
  variant?: 'inline' | 'card';
  className?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, description, trailing, variant = 'inline', className, disabled, ...rest },
  ref,
) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3.5',
        variant === 'card' &&
          'rounded-lg border border-line bg-surface px-[18px] py-[15px] transition-colors duration-fast has-[:checked]:border-green has-[:checked]:bg-[#EBEAE1]',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input ref={ref} type="radio" disabled={disabled} className="peer sr-only" {...rest} />
      <span
        aria-hidden="true"
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2',
          'border-[#C9BFA9] transition-colors duration-fast',
          'peer-checked:border-green peer-checked:[&>span]:opacity-100',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-green',
        )}
      >
        <span className="h-2.5 w-2.5 rounded-pill bg-green opacity-0 transition-opacity duration-fast" />
      </span>

      <span className="flex flex-1 flex-col">
        <span className="text-bodySm font-semibold text-ink">{label}</span>
        {description && <span className="text-caption text-muted-soft">{description}</span>}
      </span>

      {trailing && <span className="font-mono text-bodySm text-body">{trailing}</span>}
    </label>
  );
});
