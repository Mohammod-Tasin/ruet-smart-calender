'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { holidaysByDate, shiftMonth, todayInDhaka } from '@/core/calendar/grid';
import {
  api,
  clearHolidayCache,
  type AuditEntry,
  type Conflict,
  type FullHoliday,
  type PublicHoliday,
} from '@/lib/api';
import { longDate, stamp } from '@/lib/format';
import { useMonthHolidays, useStructure } from '@/lib/hooks';
import { HolidayCard } from './HolidayCard';
import { HolidayEditor, type EditorTarget } from './HolidayEditor';
import { ImpactPreview } from './ImpactPreview';
import { MonthGrid } from './MonthGrid';
import { MonthHeader } from './MonthHeader';
import { OccurrenceSheet } from './OccurrenceSheet';
import { PastConfirm } from './PastConfirm';
import { Sheet } from './Sheet';
import { SuspendSheet } from './SuspendSheet';
import { useToast } from './Toast';
import { primary, small } from './ui';

type Dialog =
  | { kind: 'day'; date: string; only?: number }
  | { kind: 'occurrence'; holiday: PublicHoliday }
  | { kind: 'edit'; target: EditorTarget; key: number }
  | { kind: 'suspend'; date: string };

/** Admin calendar: the public grid; tap a day to add a holiday, suspend the week, or change what is there. */
export function AdminCalendar({ offDays }: { offDays: number[] }) {
  const router = useRouter();
  const toast = useToast();
  const today = useMemo(() => todayInDhaka(), []);
  const [ym, setYm] = useState(today.slice(0, 7));
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [historyOf, setHistoryOf] = useState<{ id: number; title: string } | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // The server asked for the "Fix a past holiday" confirm for this delete / restore.
  const [past, setPast] = useState<{
    id: number;
    kind: 'delete' | 'restore';
    message: string;
  } | null>(null);
  const [deleted, setDeleted] = useState<FullHoliday[]>([]);

  const { structure } = useStructure();
  const { cells, holidays, failed } = useMonthHolidays(ym, offDays, { bust: true, version });

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
  const openEditor = (target: EditorTarget) => setDialog({ kind: 'edit', target, key: Date.now() });
  const sessionGone = (status: number) => status === 401 && router.replace('/admin/login');

  const onCell = (date: string, holidayId: number | string | null) => {
    if (holidayId === null) return setDialog({ kind: 'day', date });
    // Tapping a bar opens that holiday directly: a yearly one ("rule:<id>:<year>") or a one-off.
    const h = holidays?.find((x) => x.id === holidayId);
    if (h && typeof h.id === 'string') return setDialog({ kind: 'occurrence', holiday: h });
    setDialog({ kind: 'day', date, only: Number(holidayId) });
  };

  async function remove(h: { id: number; title: string }, confirmPast = false) {
    setBusyId(h.id);
    const r = await api(`/api/admin/holidays/${h.id}`, {
      method: 'DELETE',
      body: confirmPast ? { confirmPast } : undefined,
    });
    setBusyId(null);
    if (r.ok) {
      setConfirmId(null);
      setPast(null);
      toast(`"${h.title}" deleted. You can restore it from Recently deleted below.`);
      refresh();
    } else if (r.code === 'PAST_CONFIRM') {
      setPast({ id: h.id, kind: 'delete', message: r.message });
    } else {
      setConfirmId(null);
      toast(r.message, 'error');
      sessionGone(r.status);
    }
  }

  async function restore(h: FullHoliday, confirmPast = false) {
    setBusyId(h.id);
    const r = await api<{ conflicts: Conflict[] }>(`/api/admin/holidays/${h.id}/restore`, {
      method: 'POST',
      body: confirmPast ? { confirmPast } : undefined,
    });
    setBusyId(null);
    if (!r.ok && r.code === 'PAST_CONFIRM') {
      return setPast({ id: h.id, kind: 'restore', message: r.message });
    }
    if (!r.ok) return toast(r.message, 'error');
    setPast(null);
    const n = r.data.conflicts.length;
    toast(
      n
        ? `"${h.title}" restored, but it overlaps ${n} other ${n === 1 ? 'holiday' : 'holidays'}.`
        : `"${h.title}" restored.`,
      n ? 'warn' : 'success',
    );
    refresh();
  }

  const dayDate = dialog?.kind === 'day' ? dialog.date : null;
  const only = dialog?.kind === 'day' ? dialog.only : undefined;
  const dayHolidays = (
    dayDate && holidays ? (holidaysByDate(cells, holidays).get(dayDate) ?? []) : []
  ).filter((h) => only === undefined || h.id === only);

  return (
    <div className="space-y-4">
      <MonthHeader
        ym={ym}
        onPrev={() => setYm(shiftMonth(ym, -1))}
        onNext={() => setYm(shiftMonth(ym, 1))}
        onToday={() => setYm(today.slice(0, 7))}
      />
      <div className="flex flex-wrap items-center gap-2 px-1 text-sm">
        <p className="mr-auto text-zinc-600 dark:text-zinc-400">
          Tap any day to add a holiday. Tap a bar to change it.
        </p>
        <Link href={yearlyHref(Number(today.slice(0, 4)))} className={small}>
          Yearly holidays
        </Link>
      </div>

      {failed ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          Could not load the holidays.{' '}
          <button type="button" className="underline" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : (
        <MonthGrid cells={cells} holidays={holidays} today={today} onCell={onCell} />
      )}

      <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-3 py-2 font-semibold">
          Recently deleted ({deleted.length})
        </summary>
        <div className="grid gap-2 p-2 md:grid-cols-2">
          {deleted.length === 0 && (
            <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">
              Nothing has been deleted.
            </p>
          )}
          {deleted.map((h) => (
            <HolidayCard
              key={h.id}
              holiday={h}
              actions={
                <>
                  {past?.id === h.id && past.kind === 'restore' && (
                    <PastConfirm
                      message={past.message}
                      busy={busyId === h.id}
                      onConfirm={() => restore(h, true)}
                      onCancel={() => setPast(null)}
                    />
                  )}
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
      </details>

      {dialog?.kind === 'day' && (
        <Sheet
          title={only === undefined ? longDate(dialog.date) : (dayHolidays[0]?.title ?? 'Holiday')}
          onClose={() => setDialog(null)}
        >
          <div className="space-y-4">
            <div className={`grid gap-2 sm:grid-cols-2 ${only === undefined ? '' : 'hidden'}`}>
              <button
                type="button"
                className={`${primary} py-3`}
                onClick={() => openEditor({ kind: 'new', start: dialog.date, end: dialog.date })}
              >
                Add holiday
              </button>
              <button
                type="button"
                className={`${small} py-3 text-base`}
                onClick={() => setDialog({ kind: 'suspend', date: dialog.date })}
              >
                Suspend classes this week
              </button>
            </div>
            {dayHolidays.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">No holiday on this day.</p>
            ) : (
              dayHolidays.map((h) => {
                const id = h.id;
                return (
                  <HolidayCard
                    key={id}
                    holiday={h}
                    offDays={offDays}
                    actions={
                      typeof id === 'string' ? (
                        <Link
                          href={yearlyHref(h.year ?? Number(dialog.date.slice(0, 4)))}
                          className={small}
                        >
                          Change in Yearly holidays
                        </Link>
                      ) : confirmId === id ? (
                        <>
                          <span className="self-center text-sm">Delete it?</span>
                          <div className="basis-full">
                            <ImpactPreview change={{ removeIds: [id] }} />
                          </div>
                          {past?.id === id && past.kind === 'delete' ? (
                            <PastConfirm
                              message={past.message}
                              busy={busyId === id}
                              onConfirm={() => remove({ id, title: h.title }, true)}
                              onCancel={() => {
                                setPast(null);
                                setConfirmId(null);
                              }}
                            />
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={busyId === id}
                                className={`${small} border-red-700 bg-red-700 text-white hover:bg-red-800`}
                                onClick={() => remove({ id, title: h.title })}
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
                          )}
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={small}
                            onClick={() => openEditor({ kind: 'edit', id })}
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
              })
            )}
          </div>
        </Sheet>
      )}
      {dialog?.kind === 'occurrence' && (
        <OccurrenceSheet
          key={String(dialog.holiday.id)}
          holiday={dialog.holiday}
          offDays={offDays}
          onClose={() => setDialog(null)}
          onChanged={refresh}
        />
      )}
      {dialog?.kind === 'edit' && structure && (
        <HolidayEditor
          key={dialog.key}
          structure={structure}
          offDays={offDays}
          target={dialog.target}
          onClose={() => setDialog(null)}
          onEditExisting={(id) => openEditor({ kind: 'edit', id })}
          onDone={(message) => {
            toast(message);
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'suspend' && structure && (
        <SuspendSheet
          structure={structure}
          date={dialog.date}
          onClose={() => setDialog(null)}
          onEditExisting={(id) => openEditor({ kind: 'edit', id })}
          onDone={(message) => {
            toast(message);
            setDialog(null);
            refresh();
          }}
        />
      )}
      {historyOf && <HistorySheet holiday={historyOf} onClose={() => setHistoryOf(null)} />}
    </div>
  );
}

export const yearlyHref = (year: number) => `/admin?tab=calendar&view=yearly&year=${year}`;

const FIELDS = ['title', 'note', 'startDate', 'endDate', 'classesOnly'] as const;
const FIELD_LABEL: Record<string, string> = {
  title: 'title',
  note: 'note',
  startDate: 'start date',
  endDate: 'end date',
  classesOnly: 'classes off only',
};

function describe(e: AuditEntry): string {
  if (e.action !== 'UPDATE') {
    return {
      CREATE: 'Created',
      DELETE: 'Deleted',
      RESTORE: 'Restored',
      UPDATE: '',
    }[e.action];
  }
  const b = e.before ?? {};
  const a = e.after ?? {};
  const changed = FIELDS.filter((f) => b[f] !== a[f]).map((f) => FIELD_LABEL[f]!);
  if (JSON.stringify(b.audience) !== JSON.stringify(a.audience)) changed.push('who is off');
  return `Changed: ${changed.join(', ') || 'details'}`;
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
                    Saved despite overlap with: {overlaps.map((id) => `#${id}`).join(', ')}
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
