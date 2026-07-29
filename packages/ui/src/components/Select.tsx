import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from '../cn';

import { controlClasses, fieldAria, useField } from './Field';
import { Icon } from './Icon';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  options: readonly SelectOption[];
  /** Rendered as a disabled first option, so the field can start genuinely empty. */
  placeholder?: string;
  className?: string;
}

/**
 * A native `<select>` behind the mockup's styling.
 *
 * The mockup draws a custom dropdown, but a native select keeps keyboard behaviour, mobile
 * pickers and form autofill for free; only the caret is replaced.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className, defaultValue, value, ...rest },
  ref,
) {
  const field = useField();
  const hasSelection = value !== undefined || defaultValue !== undefined;

  return (
    <div className="relative flex items-center">
      <select
        ref={ref}
        className={cn(
          controlClasses(field?.invalid ?? false),
          'cursor-pointer appearance-none pr-10',
          className,
        )}
        value={value}
        defaultValue={placeholder && !hasSelection ? '' : defaultValue}
        {...fieldAria(field)}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3.5 flex text-muted-soft">
        <Icon name="caret-down" size={14} />
      </span>
    </div>
  );
});
