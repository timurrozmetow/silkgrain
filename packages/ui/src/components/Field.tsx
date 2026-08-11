import { createContext, useContext, useId, type ReactElement, type ReactNode } from 'react';

import { cn } from '../cn';

interface FieldContextValue {
  controlId: string;
  hintId: string | undefined;
  errorId: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Wiring that every control needs and nobody should retype: a label bound to the control,
 * hint and error text referenced through `aria-describedby`, and `aria-invalid` flipped
 * when there is an error. Controls read it through `useField()`.
 */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label?: ReactNode;
  /** Helper text below the control. */
  hint?: ReactNode;
  /** Validation message. Its presence is what marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  children,
  className,
}: FieldProps): ReactElement {
  const base = useId();
  const controlId = `${base}-control`;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;

  return (
    <FieldContext.Provider
      value={{ controlId, hintId, errorId, invalid: Boolean(error), required }}
    >
      <div className={cn('flex flex-col gap-2', className)}>
        {label && (
          <label htmlFor={controlId} className="text-caption font-medium text-body-muted">
            {label}
            {required && (
              <span aria-hidden="true" className="ml-1 text-terracotta">
                *
              </span>
            )}
          </label>
        )}

        {children}

        {hint && !error && (
          <p id={hintId} className="text-caption text-muted-soft">
            {hint}
          </p>
        )}

        {error && (
          // `role="alert"` so a validation failure is announced the moment it renders.
          <p id={errorId} role="alert" className="text-caption font-medium text-terracotta">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

/**
 * Shared visual treatment for text-like controls.
 *
 * `mobile:text-[16px]` is not a design choice: iOS Safari zooms the whole page when a field
 * with text under 16px takes focus, and the page never zooms back. The responsive handoff makes
 * it a rule, and it belongs here rather than at each call site - `text-bodySm` is 14px, so every
 * Input and Textarea in the product would otherwise trip it.
 */
export const controlClasses = (invalid: boolean): string =>
  cn(
    'w-full rounded-md border bg-white px-3.5 py-3 font-sans text-bodySm text-ink mobile:text-[16px]',
    'outline-none transition-[border-color,box-shadow] duration-fast',
    'placeholder:text-muted-soft',
    'disabled:cursor-not-allowed disabled:bg-surface-alt disabled:opacity-60',
    invalid
      ? 'border-terracotta bg-[#FFF5F2] focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(168,84,51,0.15)]'
      : 'border-line focus:border-sage focus:shadow-focus',
  );

/** Attributes a control must spread to participate in its Field. */
export const fieldAria = (
  field: FieldContextValue | null,
): {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
} => {
  if (!field) return {};
  const describedBy = [field.hintId, field.errorId].filter(Boolean).join(' ');
  return {
    id: field.controlId,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(field.invalid ? { 'aria-invalid': true as const } : {}),
    ...(field.required ? { required: true } : {}),
  };
};
