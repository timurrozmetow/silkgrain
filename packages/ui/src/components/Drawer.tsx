import { useCallback, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../cn';
import { useFocusTrap, useScrollLock } from '../hooks/useFocusTrap';

import { Icon } from './Icon';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Accessible name, when `title` is rich markup rather than plain text. */
  ariaLabel?: string;
  children: ReactNode;
  /** Pinned below the scrollable body: subtotal and checkout in the cart drawer. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Right-hand slide-in panel, 430px wide, used by the cart.
 *
 * It stays mounted while closed and animates on `translateX` so the slide runs in both
 * directions; `inert`-like isolation comes from the focus trap, which only engages when open.
 */
export function Drawer({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  footer,
  className,
}: DrawerProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const handleEscape = useCallback(() => {
    onClose();
  }, [onClose]);

  useFocusTrap(panelRef, { active: open, onEscape: handleEscape });
  useScrollLock(open);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {open && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="fixed inset-0 z-overlay cursor-default bg-[rgba(10,35,25,0.44)]"
        />
      )}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal={open || undefined}
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-label={ariaLabel}
        aria-hidden={!open}
        tabIndex={-1}
        className={cn(
          'fixed bottom-0 right-0 top-0 z-drawer flex w-drawer max-w-[92vw] flex-col',
          'bg-surface shadow-drawer outline-none',
          'transition-transform duration-drawer ease-standard',
          open ? 'translate-x-0' : 'translate-x-[104%]',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-line-soft px-6 py-5">
          <h2 id={titleId} className="font-serif text-h3 text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-pill bg-parchment text-body transition-colors duration-fast hover:bg-surface-alt"
          >
            <Icon name="x" size={17} />
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-6">{children}</div>

        {footer && (
          <div className="border-t border-line-soft bg-surface px-6 pb-6 pt-5">{footer}</div>
        )}
      </div>
    </>,
    document.body,
  );
}
