'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { holidaysByDate, parseMonthKey, shiftMonth, todayInDhaka } from '@/core/calendar/grid';
import { api, type PublicHoliday } from '@/lib/api';
import {
  breakDisplaySpan,
  CalendarFilter,
  CalendarScope,
  filterAndMergeBreaks,
  filterHolidays,
  isCommonHoliday,
  mergeSameBreaks,
  scopeSeriesIds,
} from '@/lib/filter-breaks';
import { longDate } from '@/lib/format';
import { useMonthHolidays, useStatus, useStructure } from '@/lib/hooks';
import { findSeries } from '@/lib/journey-ui';
import { useMySeries } from '@/lib/my-series';
import type { AcademicBreakItem } from '@/server/services/journey';
import { CalendarFilterBar } from './CalendarFilterBar';
import { HolidayCard } from './HolidayCard';
import { MonthGrid } from './MonthGrid';
import { MonthHeader } from './MonthHeader';
import { MySeriesBar } from './MySeriesBar';
import { Sheet } from './Sheet';
import { ThemeToggle } from './ThemeToggle';
import { TopNav } from './TopNav';

export { isCommonHoliday };

/** Academic breaks per visible grid range, kept for the session (the API is slow to compute). */
const breaksCache = new Map<string, AcademicBreakItem[]>();

export function PublicCalendar({ offDays }: { offDays: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = useMemo(() => todayInDhaka(), []);
  const [openDate, setOpenDate] = useState<string | null>(null);

  const ym = parseMonthKey(params.get('m')) ? params.get('m')! : today.slice(0, 7);

  const [showEverything, setShowEverything] = useState<boolean>(() => {
    return params.get('everything') === '1' || params.get('breaks') === '1';
  });

  useEffect(() => {
    setShowEverything(params.get('everything') === '1' || params.get('breaks') === '1');
  }, [params]);

  const { structure, failed: structureFailed } = useStructure();
  const { cells, holidays, failed } = useMonthHolidays(ym, offDays);
  const { data: status } = useStatus(today);
  const mine = useMySeries();

  const setParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // URL-driven filter state
  const filter: CalendarFilter = useMemo(() => {
    const scopeParam = (params.get('scope') ?? '').toUpperCase();
    const deptParam = (params.get('dept') ?? '').toUpperCase();
    const batchParam = params.get('batch') ? Number(params.get('batch')) : null;
    const everythingParam = params.get('everything') === '1' || params.get('breaks') === '1';

    let scope: CalendarScope = 'COMMON';
    let deptId: number | null = null;
    let deptCode: string | null = null;
    let seriesId: number | null = null;
    const batch = batchParam ? (batchParam < 100 ? 2000 + batchParam : batchParam) : null;

    if (structure) {
      if (deptParam) {
        const d = structure.departments.find((x) => x.code === deptParam);
        if (d) {
          deptId = d.id;
          deptCode = d.code;
          if (batch) {
            const s = structure.series.find((x) => x.departmentId === d.id && x.intakeYear === batch);
            if (s) {
              seriesId = s.id;
              scope = 'SERIES';
            } else {
              scope = 'DEPT';
            }
          } else {
            scope = 'DEPT';
          }
        }
      } else if (scopeParam === 'ALL') {
        scope = 'ALL_DEPTS';
      }
    } else {
      // Structure not loaded yet, retain params safely
      if (deptParam) {
        scope = batch ? 'SERIES' : 'DEPT';
        deptCode = deptParam;
      } else if (scopeParam === 'ALL') {
        scope = 'ALL_DEPTS';
      }
    }

    return {
      scope,
      deptId,
      deptCode,
      seriesId,
      batch,
      showEverything,
    };
  }, [params, structure, showEverything]);

  const handleFilterChange = (next: CalendarFilter) => {
    setShowEverything(next.showEverything);
    const changes: Record<string, string | null> = {};

    if (next.scope === 'COMMON') {
      changes.scope = null;
      changes.dept = null;
      changes.batch = null;
    } else if (next.scope === 'ALL_DEPTS') {
      changes.scope = 'all';
      changes.dept = null;
      changes.batch = next.batch ? String(next.batch % 100) : null;
    } else if (next.scope === 'DEPT' && next.deptCode) {
      changes.scope = null;
      changes.dept = next.deptCode;
      changes.batch = null;
    } else if (next.scope === 'SERIES' && next.deptCode && next.seriesId && structure) {
      const s = structure.series.find((x) => x.id === next.seriesId);
      changes.scope = null;
      changes.dept = next.deptCode;
      changes.batch = s ? String(s.intakeYear % 100) : null;
    }

    changes.everything = next.showEverything ? '1' : null;
    changes.breaks = null; // Clean legacy param
    changes.common = null; // Clean legacy param

    setParams(changes);
  };

  // Academic journey events (Mid, Semester, Unofficial, Exam, and Class weeks)
  const [academicBreaks, setAcademicBreaks] = useState<AcademicBreakItem[]>([]);
  // Keyed by the grid's first/last date (strings), so re-renders don't cancel the slow request.
  const gridFrom = cells[0]?.date ?? null;
  const gridTo = cells[cells.length - 1]?.date ?? null;
  const needsAcademicEvents = filter.scope !== 'COMMON' || filter.showEverything;

  useEffect(() => {
    if (!needsAcademicEvents || !gridFrom || !gridTo) {
      setAcademicBreaks([]);
      return;
    }
    const key = `${gridFrom}:${gridTo}`;
    const cached = breaksCache.get(key);
    if (cached) {
      setAcademicBreaks(cached);
      return;
    }
    let live = true;
    api<{ breaks: AcademicBreakItem[] }>(`/api/academic-breaks?from=${gridFrom}&to=${gridTo}`).then(
      (r) => {
        if (!r.ok) return;
        breaksCache.set(key, r.data.breaks);
        if (live) setAcademicBreaks(r.data.breaks);
      },
    );
    return () => {
      live = false;
    };
  }, [needsAcademicEvents, gridFrom, gridTo]);

  const visible = useMemo(() => {
    if (!holidays || !structure) return null;
    const scope = scopeSeriesIds(filter, structure);
    const base = filterHolidays(holidays, structure, filter).map(breakDisplaySpan);

    const mergedBreaks = filterAndMergeBreaks(academicBreaks, base, structure, filter).map(
      breakDisplaySpan,
    );
    return mergeSameBreaks([...base, ...mergedBreaks], structure, scope);
  }, [holidays, structure, filter, academicBreaks]);

  const goto = (key: string) => setParams({ m: key });
  const dayHolidays =
    openDate && visible ? (holidaysByDate(cells, visible).get(openDate) ?? []) : [];
  const dateInMonth = (d: string) => d.slice(0, 7);

  const mineId = structure && mine ? findSeries(structure, mine.dept, mine.year)?.id : undefined;

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

      {/* Modern, friendly calendar filter bar */}
      <CalendarFilterBar
        structure={structure}
        filter={filter}
        onChange={handleFilterChange}
        mySeries={mine}
      />

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

      {/* "My Series" status bar */}
      <MySeriesBar
        structure={structure}
        entry={mineId ? status?.series.find((x) => x.seriesId === mineId) : undefined}
        date={today}
      />

      {openDate && (
        <Sheet title={longDate(openDate)} onClose={() => setOpenDate(null)}>
          <div className="space-y-3">
            {dayHolidays.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">No holiday on this day.</p>
            ) : (
              dayHolidays.map((h) => <HolidayCard key={h.id} holiday={h} offDays={offDays} />)
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
