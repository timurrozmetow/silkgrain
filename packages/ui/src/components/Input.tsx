import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../cn';

import { controlClasses, fieldAria, useField } from './Field';
import { Icon, type IconName } from './Icon';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  /** Phosphor icon name rendered inside the control, on the left. */
  iconLeft?: IconName;
  /** Rendered inside the control on the right, e.g. an Apply button or a unit. */
  addonRight?: ReactNode;
  className?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { iconLeft, addonRight, className, type = 'text', ...rest },
  ref,
) {
  const field = useField();
  const invalid = field?.invalid ?? false;

  const control = (
    <input
      ref={ref}
      type={type}
      className={cn(controlClasses(invalid), iconLeft && 'pl-11', addonRight && 'pr-28', className)}
      {...fieldAria(field)}
      {...rest}
    />
  );

  if (!iconLeft && !addonRight) return control;

  return (
    <div className="relative flex items-center">
      {iconLeft && (
        <span className="pointer-events-none absolute left-3.5 flex text-muted-soft">
          <Icon name={iconLeft} size={18} />
        </span>
      )}
      {control}
      {addonRight && <span className="absolute right-2 flex items-center">{addonRight}</span>}
    </div>
  );
});
