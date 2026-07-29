import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '../cn';

import { controlClasses, fieldAria, useField } from './Field';

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  className?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 4, ...rest },
  ref,
) {
  const field = useField();
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(controlClasses(field?.invalid ?? false), 'resize-y', className)}
      {...fieldAria(field)}
      {...rest}
    />
  );
});
