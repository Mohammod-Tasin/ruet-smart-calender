'use client';
import { useEffect, useMemo, useState } from 'react';
import { addDays } from '@/core/calendar/hijri';
import { monthShort } from '@/core/calendar/months';
import { type JPhase, type JourneyWeek } from '@/core/journey/journey';
import { api } from '@/lib/api';
import {
  dayText,
  PHASE_LABEL,
  runningText,
  semLabel,
  seriesName,
  type JourneyResponse,
} from '@/lib/journey-ui';
import { Sheet } from './Sheet';

const STAGE_CHIP_STYLE: Partial<Record<JPhase, { off: string; on: string }>> = {
  MID_BREAK: {
    off: 'border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-200 dark:hover:bg-orange-900/70',
    on: 'border-orange-600 bg-orange-600 text-white font-bold shadow-sm ring-2 ring-orange-500 ring-offset-2 dark:border-orange-500 dark:bg-orange-600 dark:text-white',
  },
  SEMESTER_BREAK: {
    off: 'border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-200 dark:hover:bg-orange-900/70',
    on: 'border-orange-600 bg-orange-600 text-white font-bold shadow-sm ring-2 ring-orange-500 ring-offset-2 dark:border-orange-500 dark:bg-orange-600 dark:text-white',
  },
  VIVA: {
    off: 'border-purple-300 bg-purple-50 text-purple-900 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-200 dark:hover:bg-purple-900/70',
    on: 'border-purple-600 bg-purple-600 text-white font-bold shadow-sm ring-2 ring-purple-500 ring-offset-2 dark:border-purple-500 dark:bg-purple-600 dark:text-white',
  },
  EXAM: {
    off: 'border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-200 dark:hover:bg-blue-900/70',
    on: 'border-blue-600 bg-blue-600 text-white font-bold shadow-sm ring-2 ring-blue-500 ring-offset-2 dark:border-blue-500 dark:bg-blue-600 dark:text-white',
  },
};

const DEFAULT_ON =
  'border-indigo-600 bg-indigo-600 text-white font-bold shadow-sm ring-2 ring-indigo-500 ring-offset-2 dark:border-indigo-500 dark:bg-indigo-600 dark:text-white';

const DEFAULT_OFF =
  'border-zinc-300 bg-white text-zinc-800 hover:border-indigo-400 hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-indigo-950';

interface TimelineItem {
  key: string;
  label: string;
  phase: JPhase;
  weekNo: number;
}

type TimelineEntry =
  | { kind: 'item'; item: TimelineItem; date: string; week: JourneyWeek }
  | { kind: 'holiday'; weekStart: string; date: string; title: string; isUnofficial?: boolean; week: JourneyWeek };

/** Returns the Saturday immediately following `dateStr`. */
function nextSaturdayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const daysUntilSaturday = (6 - day + 7) % 7 || 7;
  return addDays(dateStr, daysUntilSaturday);
}

/** One series details: current status banner and stage timeline. */
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

function Body({ d, date }: { d: JourneyResponse; date: string }) {
  const s = d.state;
  const running = s.status === 'RUNNING';
  // Use the current semester from the running state or the earliest recorded semester
  const sem = running && s.semesterNo ? s.semesterNo : (d.weeks[0]?.semesterNo ?? 1);

  // Build the timeline entries for the current semester directly from the engine's computed weeks
  const timelineEntries = useMemo((): TimelineEntry[] => {
    const semesterWeeks = d.weeks.filter((w) => w.semesterNo === sem);
    const lastExamWeek = [...semesterWeeks].reverse().find((w) => w.phase === 'EXAM');
    const e5Date = lastExamWeek
      ? addDays(lastExamWeek.weekStart, Math.max(0, 5 - lastExamWeek.weekNo))
      : null;

    return semesterWeeks.map((w): TimelineEntry => {
      if (w.status === 'SKIPPED') {
        const isUnofficial = w.skipReasons.some(
          (r) =>
            r.category === 'UNOFFICIAL_BREAK' ||
            r.category === 'SUSPENDED_WEEK' ||
            /unofficial|auto|suspend/i.test(r.title),
        );
        const title =
          w.skipReasons.map((r) => r.title).join(', ') ||
          (isUnofficial ? 'Unofficial Break' : 'Holiday');
        return {
          kind: 'holiday',
          weekStart: w.weekStart,
          date: addDays(w.weekStart, -2),
          title,
          isUnofficial,
          week: w,
        };
      }

      let label = String(w.weekNo);
      let date = w.weekStart;

      if (w.phase === 'MID_BREAK') {
        label = 'Mid';
        date = addDays(w.weekStart, -2);
      } else if (w.phase === 'VIVA') {
        label = 'Viva';
      } else if (w.phase === 'EXAM') {
        label = `E${w.weekNo}`;
        // E1: Wed (+4 days from Sat), E2: Tue (+3), E3: Mon (+2), E4: Sun (+1), E5: Sat (+0)
        date = addDays(w.weekStart, Math.max(0, 5 - w.weekNo));
      } else if (w.phase === 'SEMESTER_BREAK') {
        label = 'Break';
        // Date is next day of E5
        date = e5Date ? addDays(e5Date, 1) : addDays(w.weekStart, 1);
      }

      return {
        kind: 'item',
        item: {
          key: `${w.phase}-${w.weekNo}-${w.weekStart}`,
          label,
          phase: w.phase,
          weekNo: w.weekNo,
        },
        date,
        week: w,
      };
    });
  }, [d.weeks, sem]);

  // Find the entry that represents the current position in time
  const currentEntry = useMemo(
    () =>
      timelineEntries.find((e) => {
        const start =
          e.kind === 'item' && e.item.phase === 'MID_BREAK'
            ? addDays(e.week.weekStart, -2)
            : e.week.weekStart;
        return date >= start && date < addDays(e.week.weekStart, 7);
      }) ?? null,
    [timelineEntries, date],
  );

  const [pickedEntry, setPickedEntry] = useState<TimelineEntry | null>(null);
  const activeEntry = pickedEntry ?? currentEntry;

  const nextSemClassStartDate = useMemo(() => {
    if (activeEntry?.kind === 'item' && activeEntry.item.phase === 'SEMESTER_BREAK') {
      return nextSaturdayAfter(activeEntry.date);
    }
    const nextSem = d.semesters.find((x) => x.semesterNo === sem + 1);
    return nextSem?.classStart ?? null;
  }, [activeEntry, d.semesters, sem]);

  // Group consecutive entries by month of their date
  const monthGroups = useMemo(() => {
    const groups: { month: string; entries: TimelineEntry[] }[] = [];
    for (const e of timelineEntries) {
      const month = e.date ? `${monthShort(e.date)} ${e.date.slice(0, 4)}` : '';
      const last = groups[groups.length - 1];
      if (last && last.month === month) last.entries.push(e);
      else groups.push({ month, entries: [e] });
    }
    return groups;
  }, [timelineEntries]);

  // Headline description
  const headlineText = running
    ? `${d.series} · Semester ${semLabel(s.semesterNo!)} · ${runningText(s)}`
    : s.status === 'GRADUATED'
      ? `${d.series} · Graduated`
      : s.status === 'BEFORE'
        ? `${d.series} · Not started yet`
        : `${d.series} · No data yet`;

  return (
    <div className="space-y-4">
      {/* Current status banner */}
      <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
        Current ({dayText(date)}): <strong>{headlineText}</strong>
      </div>

      {/* Academic Timeline */}
      <section>
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Academic Timeline
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Tap any week to view details
            </p>
          </div>
          {running && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-pulse" />
              {s.onSkippedWeek
                ? s.onUnofficialBreak
                  ? 'Unofficial Break'
                  : 'Holiday Week'
                : s.phase === 'CLASS'
                  ? `Week ${s.weekNo}`
                  : s.phase === 'EXAM'
                    ? `Final E${s.weekNo}`
                    : PHASE_LABEL[s.phase!]}
            </span>
          )}
        </div>

        {timelineEntries.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            No schedule records yet for Semester {semLabel(sem)}.
          </p>
        ) : (
          <div className="flex flex-wrap items-start gap-y-2">
            {monthGroups.flatMap((g, gi) =>
              g.entries.map((entry, ei) => {
                const first = ei === 0;
                const last = ei === g.entries.length - 1;
                const isCurrentWeek =
                  running &&
                  (entry.kind === 'item' && entry.item.phase === 'MID_BREAK'
                    ? date >= addDays(entry.week.weekStart, -2) && date < addDays(entry.week.weekStart, 7)
                    : date >= entry.week.weekStart && date < addDays(entry.week.weekStart, 7));
                const isSelected = activeEntry === entry;

                let chip: React.ReactNode;
                if (entry.kind === 'holiday') {
                  const isUnofficial = entry.isUnofficial;
                  const baseClass =
                    'flex min-w-10 cursor-pointer flex-col items-center rounded-md border border-dashed px-2 py-1.5 text-xs leading-tight font-medium transition-all';
                  const holidayStyle = isUnofficial
                    ? isCurrentWeek
                      ? 'border-zinc-600 bg-zinc-300 text-zinc-900 font-bold shadow-sm ring-2 ring-zinc-500 ring-offset-2 dark:border-zinc-400 dark:bg-zinc-700 dark:text-zinc-100'
                      : 'border-zinc-400 bg-zinc-200/80 text-zinc-700 hover:bg-zinc-300 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                    : isCurrentWeek
                      ? 'border-red-600 bg-red-100 text-red-900 font-bold shadow-sm ring-2 ring-red-500 ring-offset-2 dark:border-red-500 dark:bg-red-950 dark:text-red-100'
                      : 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200';
                  const ringClass = isSelected && !isCurrentWeek ? 'ring-2 ring-indigo-400 ring-offset-1' : '';

                  chip = (
                    <button
                      type="button"
                      onClick={() => setPickedEntry(entry)}
                      title={
                        isUnofficial
                          ? `Unofficial Break: ${entry.title}${isCurrentWeek ? ' (Current week)' : ''}`
                          : `Holiday week: ${entry.title}${isCurrentWeek ? ' (Current week)' : ''}`
                      }
                      className={`${baseClass} ${holidayStyle} ${ringClass}`}
                    >
                      <span aria-hidden>&nbsp;</span>
                      <span
                        className={`text-[10px] ${
                          isCurrentWeek ? 'font-medium opacity-90' : 'font-normal opacity-70'
                        }`}
                      >
                        {Number(entry.date.slice(8, 10))}
                      </span>
                    </button>
                  );
                } else {
                  const item = entry.item;
                  const tone = STAGE_CHIP_STYLE[item.phase];
                  const baseClass =
                    'flex min-w-10 cursor-pointer flex-col items-center rounded-md border px-2 py-1.5 text-xs font-semibold leading-tight transition-all';
                  const activeClass = isCurrentWeek
                    ? (tone?.on ?? DEFAULT_ON)
                    : (tone?.off ?? DEFAULT_OFF);
                  const ringClass =
                    isSelected && !isCurrentWeek ? 'ring-2 ring-indigo-400 ring-offset-1' : '';

                  chip = (
                    <button
                      type="button"
                      onClick={() => setPickedEntry(entry)}
                      className={`${baseClass} ${activeClass} ${ringClass}`}
                    >
                      <span>{item.label}</span>
                      {entry.date && (
                        <span
                          className={`text-[10px] ${
                            isCurrentWeek ? 'font-medium text-white/90' : 'font-normal opacity-70'
                          }`}
                        >
                          {Number(entry.date.slice(8, 10))}
                        </span>
                      )}
                    </button>
                  );
                }

                return (
                  <div
                    key={entry.kind === 'holiday' ? `H${entry.weekStart}` : entry.item.key}
                    className={`flex flex-col ${first && gi > 0 ? 'ml-2.5' : ''}`}
                  >
                    <div className={`${first ? '' : 'pl-[3px]'} ${last ? '' : 'pr-[3px]'}`}>
                      {chip}
                    </div>
                    {g.month && (
                      <>
                        <div
                          className={`mt-1 h-0.5 ${first ? 'rounded-l' : ''} ${last ? 'rounded-r' : ''} ${
                            gi % 2
                              ? 'bg-indigo-300 dark:bg-indigo-700'
                              : 'bg-zinc-300 dark:bg-zinc-600'
                          }`}
                        />
                        <span className="relative h-4">
                          {first && (
                            <span className="absolute left-0 text-[11px] font-medium whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                              {gi === 0 || g.month.startsWith('Jan')
                                ? g.month
                                : g.month.slice(0, 3)}
                            </span>
                          )}
                        </span>
                      </>
                    )}
                  </div>
                );
              }),
            )}
          </div>
        )}
      </section>

      {/* Selected Week / Holiday details panel */}
      {activeEntry && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          {activeEntry.kind === 'holiday' ? (
            <div>
              <p className="font-semibold text-rose-700 dark:text-rose-400">
                {activeEntry.isUnofficial ? 'Unofficial Break' : 'Holiday Week'} ·{' '}
                {activeEntry.title}
                {date >= activeEntry.week.weekStart &&
                  date < addDays(activeEntry.week.weekStart, 7) && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                      Current week
                    </span>
                  )}
              </p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Starting date: {dayText(activeEntry.date)} (Thursday) · Week of {dayText(activeEntry.weekStart)} –{' '}
                {dayText(addDays(activeEntry.weekStart, 6))}
                {' · '}The semester shifted by 1 week.
              </p>
            </div>
          ) : (
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                {activeEntry.item.phase === 'CLASS'
                  ? `Class week ${activeEntry.item.weekNo}`
                  : activeEntry.item.phase === 'EXAM'
                    ? `Semester Final week ${activeEntry.item.weekNo} (E${activeEntry.item.weekNo})`
                    : PHASE_LABEL[activeEntry.item.phase]}
                {date >= activeEntry.week.weekStart &&
                  date < addDays(activeEntry.week.weekStart, 7) && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                      Current week
                    </span>
                  )}
              </p>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                {activeEntry.item.phase === 'EXAM' ? (
                  <p>Exam date: {dayText(activeEntry.date)} (Week of {dayText(activeEntry.week.weekStart)})</p>
                ) : activeEntry.item.phase === 'MID_BREAK' ? (
                  <p>Break starts: {dayText(activeEntry.date)} (Thursday, including weekend)</p>
                ) : activeEntry.item.phase === 'SEMESTER_BREAK' ? (
                  <div className="space-y-1">
                    <p>Starting date: {dayText(activeEntry.date)}</p>
                    {nextSemClassStartDate && (
                      <p className="font-medium text-emerald-700 dark:text-emerald-400">
                        Next semester ({semLabel(sem + 1)}) classes start: {dayText(nextSemClassStartDate)} (Saturday)
                      </p>
                    )}
                    {sem === 8 && d.graduation && (
                      <p className="font-medium text-purple-700 dark:text-purple-400">
                        Graduation around {dayText(d.graduation)} (Saturday)
                      </p>
                    )}
                  </div>
                ) : (
                  <p>Starting date: {dayText(activeEntry.date)}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
