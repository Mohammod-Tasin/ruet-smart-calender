'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AdminCalendar } from './AdminCalendar';
import { AdminSettings } from './AdminSettings';
import { SeriesBoard } from './SeriesBoard';
import { ThemeToggle } from './ThemeToggle';
import { ToastProvider } from './Toast';
import { small } from './ui';

const TABS = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'board', label: 'Semester Status' },
  { id: 'settings', label: 'Settings' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function AdminApp({ offDays }: { offDays: number[] }) {
  return (
    <ToastProvider>
      <Admin offDays={offDays} />
    </ToastProvider>
  );
}

/** Admin shell: login gate, header, and the three screens (?tab=board|calendar|settings). */
function Admin({ offDays }: { offDays: number[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [me, setMe] = useState<{ name: string } | null>(null);
  const raw = params.get('tab');
  const tab: Tab =
    params.get('view') === 'yearly'
      ? 'settings'
      : TABS.some((t) => t.id === raw)
        ? (raw as Tab)
        : 'calendar';

  useEffect(() => {
    api<{ admin: { name: string } }>('/api/auth/me').then((r) => {
      if (r.ok) setMe(r.data.admin);
      else if (r.status === 401) router.replace('/admin/login');
    });
  }, [router]);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    router.replace('/admin/login');
  }

  if (!me) return <p className="p-4 text-sm">Loading…</p>;

  return (
    <main className="mx-auto max-w-5xl space-y-3 px-2 py-3 sm:px-4">
      <header className="flex items-center gap-2 px-1">
        <h1 className="mr-auto text-xl font-bold">RUET Admin Panel</h1>
        <Link href="/status" className={small}>
          Public Site
        </Link>
        <ThemeToggle />
        <span className="hidden text-sm text-zinc-600 sm:inline dark:text-zinc-400">{me.name}</span>
        <button type="button" className={small} onClick={logout}>
          Log out
        </button>
      </header>

      <nav
        aria-label="Admin menu"
        className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800"
      >
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/admin?tab=${t.id}`}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
                : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'board' && <SeriesBoard />}
      {tab === 'calendar' && <AdminCalendar offDays={offDays} />}
      {tab === 'settings' && <AdminSettings />}
    </main>
  );
}
