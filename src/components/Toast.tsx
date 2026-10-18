'use client';
import { createContext, useCallback, useContext, useState } from 'react';

type Kind = 'success' | 'error' | 'warn';
type Notify = (message: string, kind?: Kind) => void;

const ToastContext = createContext<Notify>(() => {});
export const useToast = () => useContext(ToastContext);

const COLORS: Record<Kind, string> = {
  success: 'bg-emerald-700 text-white',
  error: 'bg-red-700 text-white',
  warn: 'bg-amber-600 text-white',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: Kind }[]>([]);
  const notify = useCallback<Notify>((message, kind = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
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
            className={`pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm shadow-lg ${COLORS[t.kind]}`}
          >
            {t.message}
          </p>
        ))}
      </div>
    </ToastContext>
  );
}
