import clsx, { type ClassValue } from 'clsx';

/**
 * Conditional class names.
 *
 * Deliberately clsx alone, without tailwind-merge: components expose explicit variant props
 * instead of inviting callers to override utilities, so there is nothing to de-duplicate.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
