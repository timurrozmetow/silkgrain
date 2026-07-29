import { useCallback, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../cn';
import { useFocusTrap, useScrollLock } from '../hooks/useFocusTrap';

import { Icon } from './Icon';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Announced as the dialog name. Pass `hideTitle` to keep it visually hidden. */
  title: string;
  hideTitle?: boolean;
  children: ReactNode;
  /** `quickView` is the 840px two-column product preview from the catalog. */
  size?: 'sm' | 'md' | 'quickView';
  className?: string;
}

const SIZES = {
  sm: 'w-[420px]',
  md: 'w-[640px]',
  quickView: 'w-[840px]',
} as const;

/**
 * Modal dialog: focus trap, Escape to close, scroll lock, click outside to dismiss.
 *
 * Rendered through a portal on `document.body` so it escapes any `overflow: hidden` or
 * stacking context in the page behind it.
 */
export function Modal({
  open,
  onClose,
  title,
  hideTitle = false,
  children,
  size = 'md',
  className,
}: ModalProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const handleEscape = useCallback(() => {
    onClose();
  }, [onClose]);

  useFocusTrap(panelRef, { active: open, onEscape: handleEscape });
  useScrollLock(open);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center p-8">
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[rgba(10,35,25,0.44)]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative max-w-[94vw] overflow-hidden rounded-lg bg-surface shadow-modal outline-none',
          SIZES[size],
          className,
        )}
      >
        <h2 id={titleId} className={cn(hideTitle && 'sr-only')}>
          {!hideTitle && (
            <span className="block px-7 pt-6 font-serif text-h3 text-ink">{title}</span>
          )}
          {hideTitle && title}
        </h2>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 flex h-[34px] w-[34px] items-center justify-center rounded-pill bg-parchment text-body transition-colors duration-fast hover:bg-surface-alt"
        >
          <Icon name="x" size={16} />
        </button>

        {children}
      </div>
    </div>,
    document.body,
  );
}
