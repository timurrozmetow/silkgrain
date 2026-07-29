import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null || element.getClientRects().length > 0,
  );
}

export interface FocusTrapOptions {
  active: boolean;
  onEscape?: () => void;
  /** Focus returns here on close; defaults to whatever was focused when the trap opened. */
  returnFocusTo?: HTMLElement | null;
}

/**
 * Confines Tab and Shift+Tab to a container, moves focus into it on open, restores focus on
 * close, and closes on Escape.
 *
 * Required by the spec for every modal and drawer, and the reason the design system does not
 * pull in a dialog library: the behaviour is small, and owning it keeps the markup ours.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  { active, onEscape, returnFocusTo }: FocusTrapOptions,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused =
      returnFocusTo ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const initial = focusableWithin(container)[0] ?? container;
    initial.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableWithin(container);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        // Nothing to tab to: keep focus on the container rather than letting it escape.
        event.preventDefault();
        return;
      }

      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === first || !container.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [active, containerRef, onEscape, returnFocusTo]);
}

/** Prevents the page behind an overlay from scrolling, without the layout shifting. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const { body, documentElement } = document;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${String(scrollbarWidth)}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [active]);
}
