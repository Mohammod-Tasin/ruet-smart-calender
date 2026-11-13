'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isModerator, ROLE_LABEL, type AdminRole } from '@/core/auth/roles';
import { api } from '@/lib/api';
import { AdminCalendar } from './AdminCalendar';
import { AdminSettings } from './AdminSettings';
import { ManageAdmins } from './ManageAdmins';
import { SeriesBoard } from './SeriesBoard';
import { ThemeToggle } from './ThemeToggle';
import { ToastProvider } from './Toast';
import { small } from './ui';

const TABS = [
  { id: 'calendar', label: 'Calendar', moderatorOnly: true },
  { id: 'board', label: 'Semester Status', moderatorOnly: false },
  { id: 'settings', label: 'Settings', moderatorOnly: true },
  { id: 'admins', label: 'Manage Admins', moderatorOnly: true },
] as const;
type Tab = (typeof TABS)[number]['id'];

interface Me {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
}

export function AdminApp({ offDays }: { offDays: number[] }) {
  return (
    <ToastProvider>
      <Admin offDays={offDays} />
    </ToastProvider>
  );
}

/** Admin shell: login gate, header, and the role-scoped screens (?tab=board|calendar|settings|admins). */
function Admin({ offDays }: { offDays: number[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const moderator = isModerator(me?.role);
  const visibleTabs = TABS.filter((t) => !t.moderatorOnly || moderator);
  const raw = params.get('tab');
  const requested: Tab =
    params.get('view') === 'yearly'
      ? 'settings'
      : TABS.some((t) => t.id === raw)
        ? (raw as Tab)
        : 'calendar';
  const tab: Tab = moderator ? requested : 'board';

  useEffect(() => {
    api<{ admin: Me }>('/api/auth/me').then((r) => {
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
        <span className="hidden items-center gap-1.5 text-sm text-zinc-600 sm:inline-flex dark:text-zinc-400">
          {me.name}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              moderator
                ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
                : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {ROLE_LABEL[me.role]}
          </span>
        </span>
        <button type="button" className={small} onClick={logout}>
          Log out
        </button>
      </header>

      <nav
        aria-label="Admin menu"
        className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800"
      >
        {visibleTabs.map((t) => (
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
      {tab === 'calendar' && moderator && <AdminCalendar offDays={offDays} />}
      {tab === 'settings' && moderator && <AdminSettings />}
      {tab === 'admins' && moderator && <ManageAdmins currentAdminId={me.id} />}
    </main>
  );
}
