'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { appliesToSeries } from '@/core/calendar/compress';
import { holidaysByDate, parseMonthKey, shiftMonth, todayInDhaka } from '@/core/calendar/grid';
import { useMonthHolidays, useStatus, useStructure } from '@/lib/hooks';
import { findSeries } from '@/lib/journey-ui';
import { useMySeries } from '@/lib/my-series';
import { longDate } from '@/lib/format';
import { HolidayCard } from './HolidayCard';
import { MonthGrid } from './MonthGrid';
import { MonthHeader } from './MonthHeader';
import { MySeriesBar } from './MySeriesBar';
import { Sheet } from './Sheet';
import { ThemeToggle } from './ThemeToggle';
import { TopNav } from './TopNav';

export function PublicCalendar({ offDays }: { offDays: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = useMemo(() => todayInDhaka(), []);
  const [openDate, setOpenDate] = useState<string | null>(null);

  const ym = parseMonthKey(params.get('m')) ? params.get('m')! : today.slice(0, 7);
  const onlyMine = params.get('all') !== '1'; // "Only my series" is on unless ?all=1

  const { structure, failed: structureFailed } = useStructure();
  const { cells, holidays, failed } = useMonthHolidays(ym, offDays);

  const setParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const mine = useMySeries();
  const mineId = structure && mine ? findSeries(structure, mine.dept, mine.year)?.id : undefined;
  const { data: status } = useStatus(today);
  const filtering = onlyMine && !!mineId;

  const visible = useMemo(() => {
    if (!holidays || !structure) return null;
    return filtering
      ? holidays.filter((h) => appliesToSeries(h.audience, structure, mineId!))
      : holidays;
  }, [holidays, structure, filtering, mineId]);

  const goto = (key: string) => setParams({ m: key });
  const dayHolidays =
    openDate && visible ? (holidaysByDate(cells, visible).get(openDate) ?? []) : [];
  const dateInMonth = (d: string) => d.slice(0, 7);

  return (
    <main className="mx-auto max-w-5xl space-y-3 px-2 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h1 className="text-xl font-bold sm:text-2xl">RUET Holiday Calendar</h1>
        <ThemeToggle />
      </div>
      <TopNav />
      <MonthHeader
        ym={ym}
        onPrev={() => goto(shiftMonth(ym, -1))}
        onNext={() => goto(shiftMonth(ym, 1))}
        onToday={() => goto(today.slice(0, 7))}
      />

      <MySeriesBar
        structure={structure}
        entry={mineId ? status?.series.find((x) => x.seriesId === mineId) : undefined}
        date={today}
      />
      {mineId && (
        <label className="flex items-center gap-2 px-1 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-600"
            checked={onlyMine}
            onChange={(e) => setParams({ all: e.target.checked ? null : '1' })}
          />
          Only my series
        </label>
      )}

      {failed || structureFailed ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          <p>Could not load the holidays. Check your internet connection and try again.</p>
          <button
            type="button"
            className="mt-2 rounded-md bg-red-700 px-3 py-1.5 font-medium text-white"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      ) : (
        <MonthGrid cells={cells} holidays={visible} today={today} onCell={(d) => setOpenDate(d)} />
      )}

      <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
        Grey days: Thursday &amp; Friday. Striped bars: date depends on moon sighting. Tap a day for
        details.
      </p>

      {openDate && (
        <Sheet title={longDate(openDate)} onClose={() => setOpenDate(null)}>
          <div className="space-y-3">
            {dayHolidays.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No holiday on this day{filtering ? ' for your series' : ''}.
              </p>
            ) : (
              dayHolidays.map((h) => <HolidayCard key={h.id} holiday={h} />)
            )}
            {dateInMonth(openDate) !== ym && (
              <button
                type="button"
                className="text-sm underline"
                onClick={() => {
                  goto(dateInMonth(openDate));
                  setOpenDate(null);
                }}
              >
                Go to that month
              </button>
            )}
          </div>
        </Sheet>
      )}
    </main>
  );
}
