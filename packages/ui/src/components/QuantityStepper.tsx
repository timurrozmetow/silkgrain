import { useId, type ReactElement } from 'react';

import { cn } from '../cn';

import { Icon } from './Icon';

export interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Names the control for assistive tech, e.g. "Quantity of Uzbek Devzira Rice". */
  label?: string;
  className?: string;
}

const SIZES = {
  sm: { button: 'h-[38px] w-9', value: 'w-9 text-[15px]', icon: 14 },
  md: { button: 'h-[52px] w-[46px]', value: 'w-11 text-[17px]', icon: 18 },
} as const;

/**
 * Minus / value / plus.
 *
 * The value is rendered as text rather than a number input: the mockup shows no spinner,
 * and a read-only figure with two buttons is both simpler to style and easier to operate.
 * `aria-live` announces the new quantity without moving focus.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  size = 'md',
  disabled = false,
  label = 'Quantity',
  className,
}: QuantityStepperProps): ReactElement {
  const styles = SIZES[size];
  const valueId = useId();

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex items-center overflow-hidden rounded-md border border-line bg-surface',
        disabled && 'opacity-40',
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
        aria-controls={valueId}
        onClick={() => {
          onChange(Math.max(min, value - 1));
        }}
        className={cn(
          'flex items-center justify-center text-body transition-colors duration-fast',
          'hover:bg-surface-alt disabled:pointer-events-none disabled:opacity-40',
          styles.button,
        )}
      >
        <Icon name="minus" size={styles.icon} />
      </button>

      <span
        id={valueId}
        aria-live="polite"
        aria-atomic="true"
        className={cn('text-center font-mono text-ink', styles.value)}
      >
        {value}
      </span>

      <button
        type="button"
        disabled={disabled || value >= max}
        aria-label="Increase quantity"
        aria-controls={valueId}
        onClick={() => {
          onChange(Math.min(max, value + 1));
        }}
        className={cn(
          'flex items-center justify-center text-body transition-colors duration-fast',
          'hover:bg-surface-alt disabled:pointer-events-none disabled:opacity-40',
          styles.button,
        )}
      >
        <Icon name="plus" size={styles.icon} />
      </button>
    </div>
  );
}
