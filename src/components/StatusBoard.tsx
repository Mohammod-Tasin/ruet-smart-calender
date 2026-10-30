'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { todayInDhaka } from '@/core/calendar/grid';
import { bnDigits } from '@/core/journey/journey';
import { isRealDate } from '@/core/validation/holidays-query';
import { useStatus, useStructure } from '@/lib/hooks';
import { bnDate, findSeries, PHASE_BN } from '@/lib/journey-ui';
import { useMySeries } from '@/lib/my-series';
import { MySeriesBar } from './MySeriesBar';
import { SeriesSheet } from './SeriesSheet';
import { StatusMatrix } from './StatusMatrix';
import { ThemeToggle } from './ThemeToggle';
import { TopNav } from './TopNav';

const SUMMARY_ORDER = ['CLASS', 'MID_BREAK', 'VIVA', 'EXAM', 'SEMESTER_BREAK'] as const;

/** Public স্ট্যাটাস tab: my-series line, summary, the matrix, and a series sheet on tap. */
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
  const mine = useMySeries();
  const mineId = structure && mine ? findSeries(structure, mine.dept, mine.year)?.id : undefined;

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
        <h1 className="text-xl font-bold sm:text-2xl">RUET সেমিস্টার স্ট্যাটাস</h1>
        <ThemeToggle />
      </div>
      <TopNav />
      <MySeriesBar
        structure={structure}
        entry={mineId ? bySeries.get(mineId) : undefined}
        date={date}
      />

      {error || structureFailed ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          <p>স্ট্যাটাস লোড করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।</p>
          <button
            type="button"
            className="mt-2 rounded-md bg-red-700 px-3 py-1.5 font-medium text-white"
            onClick={() => setRetry((n) => n + 1)}
          >
            আবার চেষ্টা করুন
          </button>
        </div>
      ) : (
        <>
          <section
            aria-label="সারসংক্ষেপ"
            aria-live="polite"
            className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <p className="text-sm font-medium">
              {date === today ? 'আজ' : bnDate(date, true)}
              {loading ? ' …' : `: ${bnDigits(started)}টি সিরিজের সেমিস্টার চলছে`}
            </p>
            {!loading && data && started > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {SUMMARY_ORDER.filter((p) => data.summary[p]).map((p) => (
                  <li key={p}>
                    {PHASE_BN[p]} {bnDigits(data.summary[p]!)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-wrap items-end gap-2 px-1">
            <label className="text-sm">
              <span className="mb-1 block font-medium">অন্য দিনের অবস্থা</span>
              <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <span className="pb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-hidden>
              {bnDate(date, true)}
            </span>
            {date !== today && (
              <button
                type="button"
                onClick={() => setDate(today)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                আজ
              </button>
            )}
          </div>

          {structure ? (
            <StatusMatrix
              structure={structure}
              bySeries={bySeries}
              loading={loading}
              onCell={(e) => setOpen(e.seriesId)}
            />
          ) : (
            <p className="px-1 text-sm">লোড হচ্ছে…</p>
          )}
          {!loading && started === 0 && (
            <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">
              এখনো কোনো সিরিজের সেমিস্টার চালু করা হয়নি।
            </p>
          )}
        </>
      )}

      <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
        ঘরে ট্যাপ করলে সিরিজের পুরো তালিকা দেখা যাবে। ছুটির তালিকা বদলালে তারিখ বদলে যেতে পারে।
      </p>

      {open !== null && <SeriesSheet seriesId={open} date={date} onClose={() => setOpen(null)} />}
    </main>
  );
}
