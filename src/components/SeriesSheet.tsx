'use client';
import { useEffect, useState } from 'react';
import { addDays } from '@/core/calendar/hijri';
import { bnDigits, SEMESTERS, type JPhase } from '@/core/journey/journey';
import { api } from '@/lib/api';
import {
  approxDate,
  bnDate,
  delayText,
  PHASE_BN,
  PHASE_STYLE,
  runningText,
  semLabel,
  seriesName,
  SKIPPED_STRIP,
  type JourneyResponse,
} from '@/lib/journey-ui';
import { Sheet } from './Sheet';

const PHASES: JPhase[] = ['CLASS', 'MID_BREAK', 'VIVA', 'EXAM', 'SEMESTER_BREAK'];

/** One series, all 8 semesters: done ones as ticks, the current one opened, the rest projected. */
export function SeriesSheet({
  seriesId,
  date,
  onClose,
}: {
  seriesId: number;
  date: string;
  onClose: () => void;
}) {
  const [res, setRes] = useState<{ data?: JourneyResponse; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    api<JourneyResponse>(`/api/series/${seriesId}/journey?date=${date}`).then((r) => {
      if (live) setRes(r.ok ? { data: r.data } : { error: r.message });
    });
    return () => {
      live = false;
    };
  }, [seriesId, date]);

  const d = res?.data;
  return (
    <Sheet title={d ? seriesName(d.series) : 'লোড হচ্ছে…'} onClose={onClose}>
      {!res ? (
        <p className="text-sm">লোড হচ্ছে…</p>
      ) : !d ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          সিরিজের তথ্য আনা যায়নি। আবার চেষ্টা করুন।
        </p>
      ) : (
        <Body d={d} date={date} />
      )}
    </Sheet>
  );
}

function Body({ d, date }: { d: JourneyResponse; date: string }) {
  const s = d.state;
  if (s.status !== 'RUNNING' || s.semesterNo === null) {
    return (
      <p className="text-sm">
        {s.status === 'GRADUATED'
          ? 'এই সিরিজের পড়াশোনা শেষ।'
          : s.status === 'BEFORE'
            ? 'এই তারিখে সিরিজ শুরু হয়নি।'
            : 'শুরুর তারিখ এখনো দেওয়া হয়নি।'}
      </p>
    );
  }
  const cur = s.semesterNo;
  const sems = Array.from({ length: SEMESTERS }, (_, i) => i + 1);
  const sem = (n: number) => d.semesters.find((x) => x.semesterNo === n);
  const firstCounted = (n: number, phase?: JPhase) =>
    d.weeks.find(
      (w) => w.semesterNo === n && w.status === 'COUNTED' && (!phase || w.phase === phase),
    );
  const done = sems.filter((n) => n < cur);

  return (
    <div className="space-y-4">
      {done.length > 0 && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          {done.map((n) => (
            <span key={n}>
              <span aria-hidden>✓</span>
              <span className="sr-only">শেষ</span> {semLabel(n)}
            </span>
          ))}
        </p>
      )}

      <section aria-label={`${semLabel(cur)} সেমিস্টার`} className="space-y-3">
        <h3 className="text-base font-semibold">
          <span aria-hidden>● </span>
          {semLabel(cur)}{' '}
          <span className="font-normal">
            {runningText(s).replace(' (', ' · ').replace(')', '')}
          </span>
        </h3>
        <ul className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {PHASES.map((p) => {
            const w = firstCounted(cur, p);
            return w ? (
              <li key={p} className="contents">
                <span className="font-medium">{PHASE_BN[p]}</span>
                <span className="text-zinc-700 dark:text-zinc-300">
                  {approxDate(w.weekStart, w.confirmed)}
                </span>
              </li>
            ) : null;
          })}
        </ul>
        <WeekStrip weeks={d.weeks.filter((w) => w.semesterNo === cur)} today={date} />
      </section>

      <ol className="space-y-1.5 text-sm">
        {sems
          .filter((n) => n > cur)
          .map((n) => {
            const first = firstCounted(n);
            const last = n === SEMESTERS;
            const end = sem(n)?.end ?? (d.graduation ? addDays(d.graduation, -1) : null);
            return (
              <li key={n} className="flex flex-wrap gap-x-3">
                <span className="w-9 font-medium">{semLabel(n)}</span>
                <span className="text-zinc-700 dark:text-zinc-300">
                  {first ? `শুরু ${approxDate(first.weekStart, first.confirmed)}` : '—'}
                  {last && end && ` · শেষ ~${bnDate(end, true)}`}
                </span>
              </li>
            );
          })}
      </ol>

      {s.delayReasons.length > 0 && (
        <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          দেরির কারণ: {s.delayReasons.map(delayText).join('; ')}
        </p>
      )}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        ~ চিহ্নিত তারিখ আনুমানিক; ছুটির তালিকা বা কর্তৃপক্ষের সিদ্ধান্তে বদলাতে পারে।
      </p>
    </div>
  );
}

/** One box per week; month names above, today marked, holiday weeks hatched. */
function WeekStrip({ weeks, today }: { weeks: JourneyResponse['weeks']; today: string }) {
  return (
    <div>
      <div
        className="flex gap-0.5 overflow-x-auto pb-1"
        role="img"
        aria-label={`সেমিস্টারের ${bnDigits(weeks.length)} সপ্তাহ, আজকের সপ্তাহ চিহ্নিত`}
      >
        {weeks.map((w, i) => {
          const label =
            w.weekStart.slice(0, 7) !== weeks[i - 1]?.weekStart.slice(0, 7)
              ? new Date(`${w.weekStart}T00:00:00Z`).toLocaleDateString('bn-BD', {
                  month: 'short',
                  timeZone: 'UTC',
                })
              : '';
          const now = today >= w.weekStart && today < addDays(w.weekStart, 7);
          return (
            <div key={w.weekStart} className="flex w-6 shrink-0 flex-col items-center" aria-hidden>
              <span className="h-4 w-full overflow-visible text-[10px] leading-4 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                {label}
              </span>
              <span
                className={`h-5 w-full rounded-sm ${
                  w.status === 'SKIPPED' ? SKIPPED_STRIP : PHASE_STYLE[w.phase].strip
                } ${now ? 'ring-2 ring-zinc-900 ring-offset-1 dark:ring-white' : ''}`}
              />
              <span className="h-3 text-[10px] leading-3">{now ? '▲' : ''}</span>
            </div>
          );
        })}
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
        {PHASES.map((p) => (
          <li key={p} className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${PHASE_STYLE[p].strip}`} />
            {PHASE_BN[p]}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span className={`inline-block h-2.5 w-2.5 rounded-sm ${SKIPPED_STRIP}`} />
          ছুটির সপ্তাহ
        </li>
      </ul>
    </div>
  );
}
