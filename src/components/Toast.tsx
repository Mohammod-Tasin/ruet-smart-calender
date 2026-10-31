'use client';
import { createContext, useCallback, useContext, useState } from 'react';

type Kind = 'success' | 'error' | 'warn';
export interface ToastAction {
  label: string;
  onClick: () => void;
  /** How long the toast (and its button) stays, default 5 s. */
  ms?: number;
}
type Notify = (message: string, kind?: Kind, action?: ToastAction) => void;

const ToastContext = createContext<Notify>(() => {});
export const useToast = () => useContext(ToastContext);

const COLORS: Record<Kind, string> = {
  success: 'bg-emerald-700 text-white',
  error: 'bg-red-700 text-white',
  warn: 'bg-amber-600 text-white',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<
    { id: number; message: string; kind: Kind; action?: ToastAction }[]
  >([]);
  const notify = useCallback<Notify>((message, kind = 'success', action) => {
    const id = Math.random();
    const drop = () => setToasts((t) => t.filter((x) => x.id !== id));
    setToasts((t) => [...t, { id, message, kind, action }]);
    setTimeout(drop, action?.ms ?? 5000);
  }, []);

  return (
    <ToastContext value={notify}>
      {children}
      {/* top layer is above the <dialog> backdrop only for popovers, so keep z high */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <p
            key={t.id}
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-lg px-4 py-2 text-sm shadow-lg ${COLORS[t.kind]}`}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="shrink-0 rounded border border-white/70 px-2 py-0.5 font-semibold hover:bg-white/20"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </p>
        ))}
      </div>
    </ToastContext>
  );
}
