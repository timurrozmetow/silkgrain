import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../cn';

import { Icon, type IconName } from './Icon';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  tone: ToastTone;
  message: ReactNode;
}

interface ToastContextValue {
  show: (tone: ToastTone, message: ReactNode) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a <ToastProvider>');
  return context;
}

const TONES: Record<ToastTone, { frame: string; icon: IconName }> = {
  success: { frame: 'border-green-muted bg-sage-bg text-green-muted', icon: 'check-circle' },
  error: { frame: 'border-terracotta bg-terracotta-bg text-terracotta', icon: 'warning-circle' },
  info: { frame: 'border-line-warm bg-surface text-body', icon: 'info' },
};

export interface ToastProviderProps {
  children: ReactNode;
  /** Milliseconds before a toast dismisses itself. */
  duration?: number;
}

/**
 * Toasts live in a single `aria-live` region so a screen reader announces each message
 * without focus moving. Errors use `assertive`; everything else is polite.
 */
export function ToastProvider({ children, duration = 5000 }: ToastProviderProps): ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (tone: ToastTone, message: ReactNode) => {
      counter.current += 1;
      const id = `toast-${String(counter.current)}`;
      setToasts((current) => [...current, { id, tone, message }]);
      setTimeout(() => {
        dismiss(id);
      }, duration);
    },
    [dismiss, duration],
  );

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="pointer-events-none fixed bottom-6 right-6 z-toast flex flex-col gap-3">
            <div aria-live="polite" aria-atomic="false" className="flex flex-col gap-3">
              {toasts
                .filter((toast) => toast.tone !== 'error')
                .map((toast) => (
                  <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
                ))}
            </div>
            <div aria-live="assertive" aria-atomic="false" className="flex flex-col gap-3">
              {toasts
                .filter((toast) => toast.tone === 'error')
                .map((toast) => (
                  <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
                ))}
            </div>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}): ReactElement {
  const tone = TONES[toast.tone];
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-[340px] items-start gap-3 rounded-lg border px-4 py-3.5 shadow-panel',
        'animate-pop',
        tone.frame,
      )}
    >
      <Icon name={tone.icon} weight="fill" size={19} className="mt-0.5 shrink-0" />
      <span className="flex-1 text-bodySm">{toast.message}</span>
      <button
        type="button"
        onClick={() => {
          onDismiss(toast.id);
        }}
        aria-label="Dismiss notification"
        className="shrink-0 opacity-60 transition-opacity duration-fast hover:opacity-100"
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}
