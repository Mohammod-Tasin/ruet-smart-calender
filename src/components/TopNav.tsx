'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';

const TABS = [
  { href: '/', label: 'ক্যালেন্ডার' },
  { href: '/status', label: 'সেমিস্টার স্ট্যাটাস' },
];

const key = (path: string) => `tab-query:${path}`;
const read = (path: string) => {
  try {
    return sessionStorage.getItem(key(path)) ?? '';
  } catch {
    return '';
  }
};

/**
 * Public tabs. Each tab remembers its own URL state (month and filters, or the chosen date)
 * for the browser session, so switching away and back lands exactly where you were.
 */
export function TopNav() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // The other tab's saved query cannot change while this page is open, so there is nothing to
  // subscribe to; useSyncExternalStore still gives the server render ('') and the client the
  // saved value without a hydration mismatch.
  const other = pathname === '/' ? '/status' : '/';
  const savedOther = useSyncExternalStore(
    () => () => {},
    () => read(other),
    () => '',
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(key(pathname), search ? `?${search}` : '');
    } catch {
      // storage can be blocked: the tabs still work, they just open fresh
    }
  }, [pathname, search]);
  const saved: Record<string, string> = { [other]: savedOther };

  return (
    <nav
      aria-label="প্রধান মেনু"
      className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800"
    >
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={`${t.href}${active ? (search ? `?${search}` : '') : (saved[t.href] ?? '')}`}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
                : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
