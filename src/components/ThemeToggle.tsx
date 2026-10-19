'use client';
import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';
const KEY = 'theme';

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}
const read = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

function apply(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode: the choice just won't persist */
  }
}

const Sun = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const Moon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

/** Segmented Light / Dark switch. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => 'light' as Theme);
  const opt = (value: Theme, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={theme === value}
      aria-label={`${label} theme`}
      title={`${label} theme`}
      onClick={() => apply(value)}
      className={`grid h-7 w-8 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
        theme === value
          ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-700 dark:text-indigo-300 dark:ring-zinc-600'
          : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
      }`}
    >
      {icon}
    </button>
  );
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-full bg-zinc-100 p-0.5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
    >
      {opt('light', 'Light', <Sun />)}
      {opt('dark', 'Dark', <Moon />)}
    </div>
  );
}
