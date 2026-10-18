'use client';
import { useEffect, useId, useRef } from 'react';

/**
 * Modal sheet on the native <dialog>: bottom sheet on phones, side panel from md up.
 * The browser gives us Esc-to-close, focus trapping and the backdrop.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[90dvh] w-full max-w-none flex-col rounded-t-2xl bg-white p-0 text-zinc-900 open:flex md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[30rem] md:rounded-none dark:bg-zinc-900 dark:text-zinc-100 backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={() => ref.current?.close()}
          className="rounded-md px-2 py-1 text-lg leading-none hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          ✕
        </button>
      </div>
      <div className="overflow-y-auto px-4 py-3">{children}</div>
    </dialog>
  );
}
