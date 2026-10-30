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
} from '@/lib/api';
import { longDate, stamp } from '@/lib/format';
import { useMonthHolidays, useStructure } from '@/lib/hooks';
import { HolidayCard } from './HolidayCard';
import { HolidayEditor, type EditorTarget } from './HolidayEditor';
import { ImpactPreview } from './ImpactPreview';
import { MonthGrid } from './MonthGrid';
import { MonthHeader } from './MonthHeader';
import { Sheet } from './Sheet';
import { SuspendSheet } from './SuspendSheet';
import { useToast } from './Toast';
import { primary, small } from './ui';

type Dialog =
  | { kind: 'day'; date: string }
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
    // Yearly-rule occurrences ("rule:<id>:<year>") are edited in the yearly list.
    if (typeof holidayId === 'string')
      return router.push(yearlyHref(Number(holidayId.split(':')[2])));
    setDialog({ kind: 'day', date });
  };

  async function remove(h: { id: number; title: string }) {
    setBusyId(h.id);
    const r = await api(`/api/admin/holidays/${h.id}`, { method: 'DELETE' });
    setBusyId(null);
    setConfirmId(null);
    if (r.ok) {
      toast(`"${h.title}" মুছে ফেলা হয়েছে। নিচের তালিকা থেকে ফিরিয়ে আনা যাবে।`);
      refresh();
    } else {
      toast(r.message, 'error');
      sessionGone(r.status);
    }
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
        ? `"${h.title}" ফিরিয়ে আনা হয়েছে, তবে আরও ${n}টি ছুটির সাথে মিলে গেছে।`
        : `"${h.title}" ফিরিয়ে আনা হয়েছে।`,
      n ? 'warn' : 'success',
    );
    refresh();
  }

  const dayDate = dialog?.kind === 'day' ? dialog.date : null;
  const dayHolidays =
    dayDate && holidays ? (holidaysByDate(cells, holidays).get(dayDate) ?? []) : [];

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
          যেকোনো দিনে ট্যাপ করুন। ছুটি বা বারে ট্যাপ করলে সম্পাদনা, মোছা ও ইতিহাস।
        </p>
        <Link href={yearlyHref(Number(today.slice(0, 4)))} className={small}>
          বছরের ছুটির তালিকা
        </Link>
      </div>

      {failed ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          ছুটির তালিকা লোড করা যায়নি।{' '}
          <button type="button" className="underline" onClick={refresh}>
            আবার চেষ্টা করুন
          </button>
        </div>
      ) : (
        <MonthGrid cells={cells} holidays={holidays} today={today} onCell={onCell} />
      )}

      <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-3 py-2 font-semibold">
          সম্প্রতি মোছা ({deleted.length})
        </summary>
        <div className="grid gap-2 p-2 md:grid-cols-2">
          {deleted.length === 0 && (
            <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">কিছু মোছা হয়নি।</p>
          )}
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
                    {busyId === h.id ? 'ফিরছে…' : 'ফিরিয়ে আনুন'}
                  </button>
                  <button
                    type="button"
                    className={small}
                    onClick={() => setHistoryOf({ id: h.id, title: h.title })}
                  >
                    ইতিহাস
                  </button>
                </>
              }
            />
          ))}
        </div>
      </details>

      {dialog?.kind === 'day' && (
        <Sheet title={longDate(dialog.date)} onClose={() => setDialog(null)}>
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className={`${primary} py-3`}
                onClick={() => openEditor({ kind: 'new', start: dialog.date, end: dialog.date })}
              >
                ছুটি দিন
              </button>
              <button
                type="button"
                className={`${small} py-3 text-base`}
                onClick={() => setDialog({ kind: 'suspend', date: dialog.date })}
              >
                এই সপ্তাহ স্থগিত
              </button>
            </div>
            {dayHolidays.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">এই দিনে কোনো ছুটি নেই।</p>
            ) : (
              dayHolidays.map((h) => {
                const id = h.id;
                return (
                  <HolidayCard
                    key={id}
                    holiday={h}
                    actions={
                      typeof id === 'string' ? (
                        <Link
                          href={yearlyHref(h.year ?? Number(dialog.date.slice(0, 4)))}
                          className={small}
                        >
                          বছরের তালিকায় বদলান
                        </Link>
                      ) : confirmId === id ? (
                        <>
                          <span className="self-center text-sm">মুছে ফেলবেন?</span>
                          <div className="basis-full">
                            <ImpactPreview change={{ removeIds: [id] }} />
                          </div>
                          <button
                            type="button"
                            disabled={busyId === id}
                            className={`${small} border-red-700 bg-red-700 text-white hover:bg-red-800`}
                            onClick={() => remove({ id, title: h.title })}
                          >
                            {busyId === id ? 'মুছছে…' : 'হ্যাঁ, মুছুন'}
                          </button>
                          <button
                            type="button"
                            className={small}
                            disabled={busyId === id}
                            onClick={() => setConfirmId(null)}
                          >
                            বাতিল
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={small}
                            onClick={() => openEditor({ kind: 'edit', id })}
                          >
                            সম্পাদনা
                          </button>
                          <button
                            type="button"
                            className={small}
                            onClick={() => setHistoryOf({ id, title: h.title })}
                          >
                            ইতিহাস
                          </button>
                          <button type="button" className={small} onClick={() => setConfirmId(id)}>
                            মুছুন
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
const FIELD_BN: Record<string, string> = {
  title: 'শিরোনাম',
  note: 'নোট',
  startDate: 'শুরুর তারিখ',
  endDate: 'শেষের তারিখ',
  classesOnly: 'শুধু ক্লাস বন্ধ',
};

function describe(e: AuditEntry): string {
  if (e.action !== 'UPDATE') {
    return {
      CREATE: 'তৈরি করা হয়েছে',
      DELETE: 'মুছে ফেলা হয়েছে',
      RESTORE: 'ফিরিয়ে আনা হয়েছে',
      UPDATE: '',
    }[e.action];
  }
  const b = e.before ?? {};
  const a = e.after ?? {};
  const changed = FIELDS.filter((f) => b[f] !== a[f]).map((f) => FIELD_BN[f]!);
  if (JSON.stringify(b.audience) !== JSON.stringify(a.audience)) changed.push('কারা ছুটিতে');
  return `বদলানো হয়েছে: ${changed.join(', ') || 'বিস্তারিত'}`;
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
    <Sheet title={`ইতিহাস: ${holiday.title}`} onClose={onClose}>
      {!res ? (
        <p className="text-sm">লোড হচ্ছে…</p>
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
                    মিল থাকা সত্ত্বেও সংরক্ষণ: {overlaps.map((id) => `#${id}`).join(', ')}
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
