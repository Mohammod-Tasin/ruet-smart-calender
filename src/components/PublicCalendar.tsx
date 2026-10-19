'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { appliesToDepartment } from '@/core/calendar/audience';
import { appliesToSeries } from '@/core/calendar/compress';
import { holidaysByDate, parseMonthKey, shiftMonth, todayInDhaka } from '@/core/calendar/grid';
import { useMonthHolidays, useStructure } from '@/lib/hooks';
import { longDate } from '@/lib/format';
import { HolidayCard } from './HolidayCard';
import { MonthGrid } from './MonthGrid';
import { MonthHeader } from './MonthHeader';
import { Sheet } from './Sheet';
import { ThemeToggle } from './ThemeToggle';

const select =
  'rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900';

export function PublicCalendar({ offDays }: { offDays: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = useMemo(() => todayInDhaka(), []);
  const [openDate, setOpenDate] = useState<string | null>(null);

  const ym = parseMonthKey(params.get('m')) ? params.get('m')! : today.slice(0, 7);
  const deptCode = params.get('dept');
  const seriesId = Number(params.get('series')) || null;

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

  const seriesRow = structure?.series.find((s) => s.id === seriesId);
  const dept = structure?.departments.find((d) =>
    seriesRow ? d.id === seriesRow.departmentId : d.code === deptCode,
  );

  const byDate = useMemo(() => {
    if (!holidays || !structure) return null;
    const visible = holidays.filter((h) =>
      seriesRow
        ? appliesToSeries(h.audience, structure, seriesRow.id)
        : dept
          ? appliesToDepartment(h.audience, structure, dept.id)
          : true,
    );
    return holidaysByDate(cells, visible);
  }, [holidays, structure, cells, seriesRow, dept]);

  const goto = (key: string) => setParams({ m: key });
  const dayHolidays = openDate ? (byDate?.get(openDate) ?? []) : [];
  const dateInMonth = (d: string) => d.slice(0, 7);

  return (
    <main className="mx-auto max-w-5xl space-y-3 px-2 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h1 className="text-xl font-bold sm:text-2xl">RUET Holiday Calendar</h1>
        <ThemeToggle />
      </div>
      <MonthHeader
        ym={ym}
        onPrev={() => goto(shiftMonth(ym, -1))}
        onNext={() => goto(shiftMonth(ym, 1))}
        onToday={() => goto(today.slice(0, 7))}
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm">
          Department
          <select
            className={select}
            disabled={!structure}
            value={dept?.code ?? ''}
            onChange={(e) => setParams({ dept: e.target.value || null, series: null })}
          >
            <option value="">All</option>
            {structure?.departments.map((d) => (
              <option key={d.id} value={d.code}>
                {d.code}
              </option>
            ))}
          </select>
        </label>
        {dept && (
          <label className="flex items-center gap-1.5 text-sm">
            Series
            <select
              className={select}
              value={seriesRow?.id ?? ''}
              onChange={(e) =>
                setParams(
                  e.target.value
                    ? { series: e.target.value, dept: null }
                    : { series: null, dept: dept.code },
                )
              }
            >
              <option value="">All</option>
              {structure?.series
                .filter((s) => s.departmentId === dept.id)
                .sort((a, b) => b.intakeYear - a.intakeYear)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {dept.code}-{String(s.intakeYear % 100).padStart(2, '0')}
                  </option>
                ))}
            </select>
          </label>
        )}
        {(dept || seriesRow) && (
          <button
            type="button"
            className="text-sm underline"
            onClick={() => setParams({ dept: null, series: null })}
          >
            Clear filter
          </button>
        )}
      </div>

      {failed || structureFailed ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          <p>We couldn’t load the holidays. Please check your connection and try again.</p>
          <button
            type="button"
            className="mt-2 rounded-md bg-red-700 px-3 py-1.5 font-medium text-white"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      ) : (
        <MonthGrid cells={cells} byDate={byDate} today={today} onCell={(d) => setOpenDate(d)} />
      )}

      <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
        Shaded days are weekly off days. Tap a day for details.
      </p>

      {openDate && (
        <Sheet title={longDate(openDate)} onClose={() => setOpenDate(null)}>
          <div className="space-y-3">
            {dayHolidays.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No holidays on this day{dept || seriesRow ? ' for the selected filter' : ''}.
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
