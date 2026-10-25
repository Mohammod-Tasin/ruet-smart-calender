'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { todayInDhaka, shiftMonth } from '@/core/calendar/grid';
import {
  api,
  clearHolidayCache,
  type AuditEntry,
  type Conflict,
  type FullHoliday,
  type PublicHoliday,
} from '@/lib/api';
import { dateRange, stamp } from '@/lib/format';
import { useMonthHolidays, useStructure } from '@/lib/hooks';
import { HolidayCard } from './HolidayCard';
import { HolidayEditor, type EditorTarget } from './HolidayEditor';
import { MonthGrid } from './MonthGrid';
import { MonthHeader } from './MonthHeader';
import { Sheet } from './Sheet';
import { ThemeToggle } from './ThemeToggle';
import { ToastProvider, useToast } from './Toast';

const order = (a: string, b: string) => (a <= b ? { start: a, end: b } : { start: b, end: a });
const small =
  'rounded-md border border-zinc-300 px-2.5 py-1 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800';

export function AdminApp({ offDays }: { offDays: number[] }) {
  return (
    <ToastProvider>
      <Admin offDays={offDays} />
    </ToastProvider>
  );
}

function Admin({ offDays }: { offDays: number[] }) {
  const router = useRouter();
  const toast = useToast();
  const today = useMemo(() => todayInDhaka(), []);
  const [me, setMe] = useState<{ name: string } | null>(null);
  const [ym, setYm] = useState(today.slice(0, 7));
  const [version, setVersion] = useState(0);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ target: EditorTarget; key: number } | null>(null);
  const [historyOf, setHistoryOf] = useState<{ id: number; title: string } | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleted, setDeleted] = useState<FullHoliday[]>([]);
  const drag = useRef<{ anchor: string; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const { structure } = useStructure();
  const { cells, holidays, failed } = useMonthHolidays(ym, offDays, { bust: true, version });

  // Auth gate.
  useEffect(() => {
    api<{ admin: { name: string } }>('/api/auth/me').then((r) => {
      if (r.ok) setMe(r.data.admin);
      else if (r.status === 401) router.replace('/admin/login');
    });
  }, [router]);

  // Recently deleted list; reloads after every change.
  useEffect(() => {
    api<{ holidays: FullHoliday[] }>('/api/admin/holidays/deleted').then((r) => {
      if (r.ok) setDeleted(r.data.holidays);
    });
  }, [version]);

  const refresh = () => {
    clearHolidayCache();
    setVersion((v) => v + 1);
  };

  // Click-drag range selection (mouse). Touch and keyboard use tap start + tap end.
  const openNew = (r: { start: string; end: string }) => {
    setPendingStart(null);
    setRange(r);
    setEditor({ target: { kind: 'new', start: r.start, end: r.end }, key: Date.now() });
  };
  useEffect(() => {
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (d?.moved) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        setRange((r) => {
          if (r) openNew(r);
          return r;
        });
      }
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const onCell = (date: string, holidayId: number | string | null) => {
    // Yearly-rule occurrences ("rule:<id>:<year>") are edited on the Yearly holidays page.
    if (typeof holidayId === 'string') {
      return router.push(`/admin/yearly?year=${holidayId.split(':')[2]}`);
    }
    if (holidayId) return setEditor({ target: { kind: 'edit', id: holidayId }, key: Date.now() });
    if (suppressClick.current) return;
    if (pendingStart === null) {
      setPendingStart(date);
      setRange({ start: date, end: date });
    } else {
      openNew(order(pendingStart, date));
    }
  };

  const closeEditor = () => {
    setEditor(null);
    setRange(null);
    setPendingStart(null);
  };

  async function remove(h: PublicHoliday & { id: number }) {
    setBusyId(h.id);
    const r = await api(`/api/admin/holidays/${h.id}`, { method: 'DELETE' });
    setBusyId(null);
    setConfirmId(null);
    if (r.ok) toast(`Deleted "${h.title}". You can restore it below.`);
    else toast(r.message, 'error');
    if (r.ok) refresh();
    else if (r.status === 401) router.replace('/admin/login');
  }

  async function restore(h: FullHoliday) {
    setBusyId(h.id);
    const r = await api<{ conflicts: Conflict[] }>(`/api/admin/holidays/${h.id}/restore`, {
      method: 'POST',
    });
    setBusyId(null);
    if (!r.ok) return toast(r.message, 'error');
    const n = r.data.conflicts.length;
    toast(
      n
        ? `Restored "${h.title}", but it overlaps ${n} other holiday${n > 1 ? 's' : ''}.`
        : `Restored "${h.title}".`,
      n ? 'warn' : 'success',
    );
    refresh();
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    router.replace('/admin/login');
  }

  if (!me) return <p className="p-4 text-sm">Loading…</p>;

  const monthCells = cells.filter((c) => c.inMonth);
  const monthStart = monthCells[0]!.date;
  const monthEnd = monthCells[monthCells.length - 1]!.date;
  const inView = (holidays ?? []).filter((h) => h.startDate <= monthEnd && h.endDate >= monthStart);

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-2 py-3 sm:px-4">
      <header className="flex items-center gap-2 px-1">
        <h1 className="mr-auto text-xl font-bold">Admin</h1>
        <Link href="/admin/yearly" className={small}>
          Yearly holidays
        </Link>
        <ThemeToggle />
        <span className="hidden text-sm text-zinc-600 sm:inline dark:text-zinc-400">{me.name}</span>
        <button type="button" className={small} onClick={logout}>
          Log out
        </button>
      </header>

      <MonthHeader
        ym={ym}
        onPrev={() => setYm(shiftMonth(ym, -1))}
        onNext={() => setYm(shiftMonth(ym, 1))}
        onToday={() => setYm(today.slice(0, 7))}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <p className="mr-auto text-zinc-600 dark:text-zinc-400" aria-live="polite">
          {pendingStart
            ? `Start: ${dateRange(pendingStart, pendingStart)}. Now tap the end day (same day again for one day).`
            : 'Drag across days, or tap a start day then an end day. You can change months in between.'}
        </p>
        {pendingStart && (
          <button type="button" className={small} onClick={closeEditor}>
            Clear selection
          </button>
        )}
        <button
          type="button"
          className={`${small} bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-500`}
          onClick={() => openNew(range ?? { start: today, end: today })}
        >
          + New holiday
        </button>
      </div>

      {failed ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          Couldn’t load holidays.{' '}
          <button type="button" className="underline" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : (
        <MonthGrid
          cells={cells}
          holidays={holidays}
          today={today}
          range={range}
          onCell={onCell}
          onCellDown={(date) => (drag.current = { anchor: date, moved: false })}
          onCellEnter={(date) => {
            const d = drag.current;
            if (!d || (!d.moved && date === d.anchor)) return;
            d.moved = true;
            setPendingStart(null);
            setRange(order(d.anchor, date));
          }}
        />
      )}

      <section aria-labelledby="in-view">
        <h2 id="in-view" className="mb-2 px-1 font-semibold">
          Holidays this month
        </h2>
        {holidays === null ? (
          <p className="px-1 text-sm">Loading…</p>
        ) : inView.length === 0 ? (
          <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">None yet.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {inView.map((h) => {
              const id = h.id;
              return (
                <HolidayCard
                  key={id}
                  holiday={h}
                  actions={
                    typeof id === 'string' ? (
                      <Link href={`/admin/yearly?year=${h.year}`} className={small}>
                        Edit on Yearly holidays page
                      </Link>
                    ) : confirmId === id ? (
                      <>
                        <span className="self-center text-sm">Delete this holiday?</span>
                        <button
                          type="button"
                          disabled={busyId === id}
                          className={`${small} border-red-700 bg-red-700 text-white hover:bg-red-800`}
                          onClick={() => remove({ ...h, id })}
                        >
                          {busyId === id ? 'Deleting…' : 'Yes, delete'}
                        </button>
                        <button
                          type="button"
                          className={small}
                          disabled={busyId === id}
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={small}
                          onClick={() =>
                            setEditor({ target: { kind: 'edit', id }, key: Date.now() })
                          }
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={small}
                          onClick={() => setHistoryOf({ id, title: h.title })}
                        >
                          History
                        </button>
                        <button type="button" className={small} onClick={() => setConfirmId(id)}>
                          Delete
                        </button>
                      </>
                    )
                  }
                />
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="deleted">
        <h2 id="deleted" className="mb-2 px-1 font-semibold">
          Recently deleted
        </h2>
        {deleted.length === 0 ? (
          <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">Nothing deleted.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {deleted.map((h) => (
              <HolidayCard
                key={h.id}
                holiday={h}
                actions={
                  <>
                    <button
                      type="button"
                      className={small}
                      disabled={busyId === h.id}
                      onClick={() => restore(h)}
                    >
                      {busyId === h.id ? 'Restoring…' : 'Restore'}
                    </button>
                    <button
                      type="button"
                      className={small}
                      onClick={() => setHistoryOf({ id: h.id, title: h.title })}
                    >
                      History
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </section>

      {editor && structure && (
        <HolidayEditor
          key={editor.key}
          structure={structure}
          target={editor.target}
          onClose={closeEditor}
          onEditExisting={(id) => setEditor({ target: { kind: 'edit', id }, key: Date.now() })}
          onDone={(message) => {
            toast(message);
            closeEditor();
            refresh();
          }}
        />
      )}
      {historyOf && <HistorySheet holiday={historyOf} onClose={() => setHistoryOf(null)} />}
    </main>
  );
}

const FIELDS = ['title', 'note', 'startDate', 'endDate', 'classesOnly'] as const;

function describe(e: AuditEntry): string {
  if (e.action !== 'UPDATE')
    return { CREATE: 'Created', DELETE: 'Deleted', RESTORE: 'Restored', UPDATE: '' }[e.action];
  const b = e.before ?? {};
  const a = e.after ?? {};
  const changed: string[] = FIELDS.filter((f) => b[f] !== a[f]).map((f) =>
    f === 'startDate'
      ? 'from date'
      : f === 'endDate'
        ? 'to date'
        : f === 'classesOnly'
          ? 'classes-only'
          : f,
  );
  if (JSON.stringify(b.audience) !== JSON.stringify(a.audience)) changed.push('audience');
  return `Changed ${changed.join(', ') || 'details'}`;
}

function HistorySheet({
  holiday,
  onClose,
}: {
  holiday: { id: number; title: string };
  onClose: () => void;
}) {
  const [res, setRes] = useState<{ entries?: AuditEntry[]; error?: string } | null>(null);
  useEffect(() => {
    api<{ entries: AuditEntry[] }>(`/api/admin/audit?holidayId=${holiday.id}`).then((r) =>
      setRes(r.ok ? { entries: r.data.entries } : { error: r.message }),
    );
  }, [holiday.id]);

  return (
    <Sheet title={`History: ${holiday.title}`} onClose={onClose}>
      {!res ? (
        <p className="text-sm">Loading…</p>
      ) : res.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {res.error}
        </p>
      ) : (
        <ol className="space-y-2">
          {res.entries!.map((e) => {
            const overlaps = e.after?.confirmedOverlapWith as number[] | undefined;
            return (
              <li
                key={e.id}
                className="rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-800"
              >
                <p className="font-medium">{describe(e)}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {e.admin.name} · {stamp(e.at)}
                </p>
                {overlaps && overlaps.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Saved despite overlap with {overlaps.map((id) => `#${id}`).join(', ')}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Sheet>
  );
}
