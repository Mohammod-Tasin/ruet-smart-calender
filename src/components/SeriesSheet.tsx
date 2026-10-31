'use client';
import { useEffect, useState } from 'react';
import { addDays } from '@/core/calendar/hijri';
import { monthShort } from '@/core/calendar/months';
import { SEMESTERS, type JPhase } from '@/core/journey/journey';
import { api } from '@/lib/api';
import {
  approxDate,
  dayText,
  delayText,
  PHASE_LABEL,
  PHASE_STYLE,
  rangeText,
  runningText,
  semLabel,
  seriesName,
  SKIPPED_STRIP,
  weeksText,
  weekTip,
  type JourneyResponse,
} from '@/lib/journey-ui';
import { Sheet } from './Sheet';

const PHASES: JPhase[] = ['CLASS', 'MID_BREAK', 'VIVA', 'EXAM', 'SEMESTER_BREAK'];

/** One series: this semester's stages, what is next, and why it slipped. The rest is folded away. */
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
    <Sheet title={d ? seriesName(d.series) : 'Loading…'} onClose={onClose}>
      {!res ? (
        <p className="text-sm">Loading…</p>
      ) : !d ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Could not load this series. Please try again.
        </p>
      ) : (
        <Body d={d} date={date} />
      )}
    </Sheet>
  );
}

/** "27 Jun – 26 Sep", or just "15 Aug" for a one-week phase; "around" until it is confirmed. */
function phaseRange(weeks: JourneyResponse['weeks']): string {
  const first = weeks[0]!;
  const lastDay = addDays(weeks[weeks.length - 1]!.weekStart, 4); // Wednesday
  const text = weeks.length === 1 ? dayText(first.weekStart) : rangeText(first.weekStart, lastDay);
  return first.confirmed ? text : `around ${text}`;
}

function Body({ d, date }: { d: JourneyResponse; date: string }) {
  const s = d.state;
  if (s.status !== 'RUNNING' || s.semesterNo === null) {
    return (
      <p className="text-sm">
        {s.status === 'GRADUATED'
          ? 'This batch has finished its studies.'
          : s.status === 'BEFORE'
            ? 'This batch had not started on this date.'
            : 'No data yet for this batch.'}
      </p>
    );
  }
  const cur = s.semesterNo;
  const sems = Array.from({ length: SEMESTERS }, (_, i) => i + 1);
  const sem = (n: number) => d.semesters.find((x) => x.semesterNo === n);
  const firstCounted = (n: number) =>
    d.weeks.find((w) => w.semesterNo === n && w.status === 'COUNTED');
  const counted = (n: number, phase: JPhase) =>
    d.weeks.filter((w) => w.semesterNo === n && w.phase === phase && w.status === 'COUNTED');
  const nowIdx = PHASES.indexOf(s.phase!);
  const next = s.nextSemester;
  const last = sem(SEMESTERS);

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">
        Semester {semLabel(cur)} · {runningText(s)}
      </p>

      <section aria-label="This semester" className="space-y-1">
        <h3 className="text-sm font-semibold">This semester</h3>
        <ul className="grid grid-cols-[1rem_auto_1fr] items-baseline gap-x-2 gap-y-1 text-sm">
          {PHASES.map((p, i) => {
            const w = counted(cur, p);
            if (w.length === 0) return null;
            return (
              <li key={p} className="contents">
                <span aria-hidden>{i < nowIdx ? '✓' : i === nowIdx ? '●' : ''}</span>
                <span className={i === nowIdx ? 'font-semibold' : 'font-medium'}>
                  {p === 'CLASS' ? 'Classes' : PHASE_LABEL[p]}
                </span>
                <span className="text-zinc-700 dark:text-zinc-300">
                  {phaseRange(w)}
                  {i === nowIdx && ' ← now'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Next" className="space-y-1">
        <h3 className="text-sm font-semibold">Next</h3>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {next
            ? `Semester ${semLabel(next.semesterNo)} starts ${approxDate(next.date, next.confirmed)}`
            : cur === SEMESTERS && s.nextMilestone?.phase === 'GRADUATION'
              ? `Studies end around ${dayText(s.nextMilestone.date)}`
              : '—'}
        </p>
      </section>

      {s.delayReasons.length > 0 && (
        <section
          aria-label="Delays"
          className="rounded-md bg-amber-50 p-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
        >
          <p className="font-medium">
            Delayed so far this semester:{' '}
            {weeksText(s.delayReasons.reduce((n, r) => n + r.weeks, 0))}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {s.delayReasons.map((r) => (
              <li key={r.reason}>{delayText(r)}</li>
            ))}
          </ul>
        </section>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer font-medium underline">Show full plan</summary>
        <div className="mt-2 space-y-3">
          <ol className="space-y-1.5">
            {sems
              .filter((n) => n > cur)
              .map((n) => {
                const first = firstCounted(n);
                const end =
                  n === SEMESTERS
                    ? (last?.end ?? (d.graduation ? addDays(d.graduation, -1) : null))
                    : null;
                return (
                  <li key={n} className="flex flex-wrap gap-x-3">
                    <span className="w-24 font-medium">Semester {semLabel(n)}</span>
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {first ? `starts ${approxDate(first.weekStart, first.confirmed)}` : '—'}
                      {end && ` · ends around ${dayText(end)}`}
                    </span>
                  </li>
                );
              })}
          </ol>
          <WeekStrip weeks={d.weeks.filter((w) => w.semesterNo === cur)} today={date} />
        </div>
      </details>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Dates marked &quot;around&quot; are expected; they can change with the holiday list or
        university decisions.
      </p>
    </div>
  );
}

/** One box per week; month names above, today marked, holiday weeks hatched. */
function WeekStrip({ weeks, today }: { weeks: JourneyResponse['weeks']; today: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const tip = weeks.find((w) => w.weekStart === picked);
  return (
    <div>
      <div className="flex gap-0.5 overflow-x-auto pb-1">
        {weeks.map((w, i) => {
          const label =
            w.weekStart.slice(0, 7) !== weeks[i - 1]?.weekStart.slice(0, 7)
              ? monthShort(w.weekStart)
              : '';
          const now = today >= w.weekStart && today < addDays(w.weekStart, 7);
          return (
            <div key={w.weekStart} className="flex w-6 shrink-0 flex-col items-center">
              <span className="h-4 w-full overflow-visible text-[10px] leading-4 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                {label}
              </span>
              <button
                type="button"
                title={weekTip(w)}
                aria-label={weekTip(w)}
                aria-pressed={picked === w.weekStart}
                onClick={() => setPicked(picked === w.weekStart ? null : w.weekStart)}
                className={`h-6 w-full rounded-sm text-[10px] leading-6 font-medium text-white ${
                  w.status === 'SKIPPED'
                    ? `${SKIPPED_STRIP} text-zinc-900 dark:text-white`
                    : PHASE_STYLE[w.phase].strip
                } ${now ? 'ring-2 ring-zinc-900 ring-offset-1 dark:ring-white' : ''}`}
              >
                {Number(w.weekStart.slice(8, 10))}
              </button>
              <span className="h-3 text-[10px] leading-3">{now ? '▲' : ''}</span>
            </div>
          );
        })}
      </div>
      <p className="min-h-5 text-xs text-zinc-700 dark:text-zinc-300">
        {tip ? weekTip(tip) : 'Tap a week for its dates.'}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
        {PHASES.map((p) => (
          <li key={p} className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${PHASE_STYLE[p].strip}`} />
            {PHASE_LABEL[p]}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span className={`inline-block h-2.5 w-2.5 rounded-sm ${SKIPPED_STRIP}`} />
          Holiday week
        </li>
      </ul>
    </div>
  );
}
