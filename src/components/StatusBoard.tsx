'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { todayInDhaka } from '@/core/calendar/grid';
import { addDays } from '@/core/calendar/hijri';
import { isRealDate } from '@/core/validation/holidays-query';
import { useStatus, useStructure } from '@/lib/hooks';
import { dayText, PHASE_SHORT } from '@/lib/journey-ui';
import { GenerateReportButton } from './HolidayReport';
import { SeriesSheet } from './SeriesSheet';
import { StatusMatrix } from './StatusMatrix';
import { ThemeToggle } from './ThemeToggle';
import { TopNav } from './TopNav';

const SUMMARY_ORDER = ['CLASS', 'MID_BREAK', 'VIVA', 'EXAM', 'SEMESTER_BREAK'] as const;

const SUMMARY_CHIP_STYLE: Record<
  (typeof SUMMARY_ORDER)[number],
  { bg: string; border: string; text: string; dot: string }
> = {
  CLASS: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    border: 'border-emerald-200 dark:border-emerald-800/60',
    text: 'text-emerald-900 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  },
  MID_BREAK: {
    bg: 'bg-orange-50 dark:bg-orange-950/40',
    border: 'border-orange-200 dark:border-orange-800/60',
    text: 'text-orange-900 dark:text-orange-200',
    dot: 'bg-orange-500',
  },
  VIVA: {
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    border: 'border-purple-200 dark:border-purple-800/60',
    text: 'text-purple-900 dark:text-purple-200',
    dot: 'bg-purple-500',
  },
  EXAM: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    border: 'border-blue-200 dark:border-blue-800/60',
    text: 'text-blue-900 dark:text-blue-200',
    dot: 'bg-blue-500',
  },
  SEMESTER_BREAK: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    border: 'border-rose-200 dark:border-rose-800/60',
    text: 'text-rose-900 dark:text-rose-200',
    dot: 'bg-rose-500',
  },
};

/** Public Semester Status tab: summary, the matrix, holiday report at the bottom, and a series sheet on tap. */
export function StatusBoard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = useMemo(() => todayInDhaka(), []);
  const raw = params.get('d');
  const date = raw && isRealDate(raw) ? raw : today;

  const { structure, failed: structureFailed } = useStructure();
  const [retry, setRetry] = useState(0);
  const { data, error, loading } = useStatus(date, { version: retry });
  const [open, setOpen] = useState<number | null>(null);

  const setDate = (d: string) => {
    const next = new URLSearchParams(params.toString());
    if (!d || d === today) next.delete('d');
    else next.set('d', d);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const bySeries = useMemo(() => new Map(data?.series.map((s) => [s.seriesId, s])), [data]);
  const started = data?.series.filter((s) => s.state.status === 'RUNNING').length ?? 0;

  return (
    <main className="mx-auto max-w-5xl space-y-3 px-2 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h1 className="text-xl font-bold sm:text-2xl">RUET Semester Status</h1>
        <ThemeToggle />
      </div>
      <TopNav />

      {error || structureFailed ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          <p>Could not load the status. Check your internet connection and try again.</p>
          <button
            type="button"
            className="mt-2 rounded-md bg-red-700 px-3 py-1.5 font-medium text-white"
            onClick={() => setRetry((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <section
            aria-label="Summary"
            aria-live="polite"
            className="rounded-xl border border-zinc-200 bg-white p-3.5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900/60"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                All departments · {date === today ? 'Today' : dayText(date)}
                {loading ? ' …' : ''}
              </p>
              {!loading && started > 0 && (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {started} active series
                </span>
              )}
            </div>

            {!loading && data && started > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {SUMMARY_ORDER.filter((p) => data.summary[p]).map((p) => {
                  const style = SUMMARY_CHIP_STYLE[p];
                  return (
                    <div
                      key={p}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${style.bg} ${style.border} ${style.text}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                      <span className="font-bold text-sm leading-none">{data.summary[p]!}</span>
                      <span className="font-medium">{PHASE_SHORT[p]}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="flex flex-wrap items-end justify-between gap-2 px-1">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="status-date-input" className="mb-1 block text-sm font-medium">
                  Show another date
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="status-date-input"
                    type="date"
                    value={date}
                    onChange={(e) => e.target.value && setDate(e.target.value)}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={() => setDate(addDays(date, -7))}
                    aria-label="Previous week"
                    title="Previous week (-1 week)"
                    className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDate(addDays(date, 7))}
                    aria-label="Next week"
                    title="Next week (+1 week)"
                    className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
              <span className="pb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-hidden>
                {dayText(date)}
              </span>
              {date !== today && (
                <button
                  type="button"
                  onClick={() => setDate(today)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Today
                </button>
              )}
            </div>

            <GenerateReportButton date={date} />
          </div>

          {structure ? (
            <StatusMatrix
              structure={structure}
              bySeries={bySeries}
              loading={loading}
              onCell={(e) => setOpen(e.seriesId)}
            />
          ) : (
            <p className="px-1 text-sm">Loading…</p>
          )}
          {!loading && started === 0 && (
            <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">
              No batch has a semester status yet.
            </p>
          )}
        </>
      )}

      <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
        Tap a box to see that batch&apos;s plan. Dates can change when the holiday list changes.
      </p>

      {open !== null && <SeriesSheet seriesId={open} date={date} onClose={() => setOpen(null)} />}
    </main>
  );
}
