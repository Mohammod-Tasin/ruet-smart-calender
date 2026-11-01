'use client';
import { useMemo } from 'react';
import type { Structure } from '@/core/calendar/types';
import type { CalendarFilter } from '@/lib/filter-breaks';

interface CalendarFilterBarProps {
  structure: Structure | null;
  filter: CalendarFilter;
  onChange: (filter: CalendarFilter) => void;
  mySeries?: { dept: string; year: number } | null;
  onPickMySeries?: () => void;
}

export function CalendarFilterBar({
  structure,
  filter,
  onChange,
  mySeries,
}: CalendarFilterBarProps) {
  // Sort departments alphabetically by code
  const departments = useMemo(() => {
    if (!structure) return [];
    return [...structure.departments].sort((a, b) => a.code.localeCompare(b.code));
  }, [structure]);

  // Distinct active batches across all departments (or for current department)
  const allBatches = useMemo(() => {
    if (!structure) return [];
    const source = filter.deptId
      ? structure.series.filter((s) => s.departmentId === filter.deptId && s.isActive)
      : structure.series.filter((s) => s.isActive);
    const set = new Set<number>();
    for (const s of source) {
      set.add(s.intakeYear);
    }
    return [...set].sort((a, b) => a - b);
  }, [structure, filter.deptId]);

  // Toggle "All" departments
  const handleAllToggle = () => {
    if (filter.scope === 'ALL_DEPTS') {
      // Toggle off back to Default (COMMON)
      onChange({
        scope: 'COMMON',
        deptId: null,
        deptCode: null,
        seriesId: null,
        batch: null,
        showEverything: filter.showEverything,
      });
    } else {
      onChange({
        scope: 'ALL_DEPTS',
        deptId: null,
        deptCode: null,
        seriesId: null,
        batch: filter.batch ?? null,
        showEverything: filter.showEverything,
      });
    }
  };

  // Toggle a specific department button (CE, CSE, EEE, etc.)
  const handleDeptToggle = (deptId: number, deptCode: string) => {
    if (filter.deptId === deptId) {
      // Toggle off back to Default (COMMON)
      onChange({
        scope: 'COMMON',
        deptId: null,
        deptCode: null,
        seriesId: null,
        batch: null,
        showEverything: filter.showEverything,
      });
    } else {
      let seriesId: number | null = null;
      if (filter.batch && structure) {
        const s = structure.series.find(
          (x) => x.departmentId === deptId && x.intakeYear === filter.batch,
        );
        seriesId = s?.id ?? null;
      }
      onChange({
        scope: seriesId ? 'SERIES' : 'DEPT',
        deptId,
        deptCode,
        seriesId,
        batch: filter.batch ?? null,
        showEverything: filter.showEverything,
      });
    }
  };

  // Select a batch/series (e.g. 'All series', '21', '22', etc.)
  const handleBatchSelect = (batchYear: number | null) => {
    if (batchYear === null || (filter.batch === batchYear && !filter.seriesId)) {
      // "All series" selected
      if (filter.scope === 'SERIES' && filter.deptId) {
        onChange({
          ...filter,
          scope: 'DEPT',
          seriesId: null,
          batch: null,
        });
      } else {
        onChange({
          ...filter,
          seriesId: null,
          batch: null,
        });
      }
    } else {
      // Specific batch selected (e.g. 2021)
      if (filter.deptId && structure) {
        const s = structure.series.find(
          (x) => x.departmentId === filter.deptId && x.intakeYear === batchYear,
        );
        onChange({
          ...filter,
          scope: s ? 'SERIES' : 'DEPT',
          seriesId: s?.id ?? null,
          batch: batchYear,
        });
      } else {
        // If in COMMON or ALL_DEPTS, select ALL_DEPTS with this batch
        onChange({
          ...filter,
          scope: 'ALL_DEPTS',
          deptId: null,
          deptCode: null,
          seriesId: null,
          batch: batchYear,
        });
      }
    }
  };

  const handleSelectMySeries = () => {
    if (!structure || !mySeries) return;
    const dept = structure.departments.find((d) => d.code === mySeries.dept);
    if (!dept) return;
    const s = structure.series.find(
      (x) => x.departmentId === dept.id && x.intakeYear === mySeries.year,
    );
    if (!s) return;
    onChange({
      scope: 'SERIES',
      deptId: dept.id,
      deptCode: dept.code,
      seriesId: s.id,
      batch: mySeries.year,
      showEverything: filter.showEverything,
    });
  };

  const isMySeriesSelected =
    filter.scope === 'SERIES' &&
    filter.seriesId !== null &&
    mySeries &&
    structure?.series.some(
      (s) =>
        s.id === filter.seriesId &&
        s.intakeYear === mySeries.year &&
        structure.departments.some((d) => d.id === s.departmentId && d.code === mySeries.dept),
    );

  // Active batch year: either filter.batch, or deduced from filter.seriesId
  const activeBatchYear = useMemo(() => {
    if (filter.batch) return filter.batch;
    if (filter.seriesId && structure) {
      const s = structure.series.find((x) => x.id === filter.seriesId);
      return s ? s.intakeYear : null;
    }
    return null;
  }, [filter.batch, filter.seriesId, structure]);

  const hasAnyFilter = filter.scope !== 'COMMON' || filter.batch !== null;

  const handleClearToDefault = () => {
    onChange({
      scope: 'COMMON',
      deptId: null,
      deptCode: null,
      seriesId: null,
      batch: null,
      showEverything: filter.showEverything,
    });
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-zinc-200 bg-white p-3 shadow-xs dark:border-zinc-800 dark:bg-zinc-900/60">
      {/* Row 1: Department buttons: All, CE, CSE, EEE, ME, etc. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={handleAllToggle}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
            filter.scope === 'ALL_DEPTS'
              ? 'bg-indigo-600 font-semibold text-white shadow-xs'
              : 'border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
          }`}
        >
          All
        </button>
        {departments.map((d) => {
          const isSelected =
            (filter.scope === 'DEPT' || filter.scope === 'SERIES') && filter.deptId === d.id;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => handleDeptToggle(d.id, d.code)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                isSelected
                  ? 'bg-indigo-600 font-semibold text-white shadow-xs'
                  : 'border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              {d.code}
            </button>
          );
        })}

        {hasAnyFilter && (
          <button
            type="button"
            onClick={handleClearToDefault}
            className="ml-auto rounded-md px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            title="Reset to default common holidays"
          >
            ✕ Reset
          </button>
        )}
      </div>

      {/* Row 2: Series / Batch buttons + Show Everything toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800/80">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleBatchSelect(null)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              activeBatchYear === null
                ? 'bg-indigo-600 font-semibold text-white shadow-xs'
                : 'border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
            }`}
          >
            All series
          </button>
          {allBatches.map((yr) => {
            const yrStr = String(yr % 100).padStart(2, '0');
            const isSelected = activeBatchYear === yr;
            return (
              <button
                key={yr}
                type="button"
                onClick={() => handleBatchSelect(yr)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                  isSelected
                    ? 'bg-indigo-600 font-semibold text-white shadow-xs'
                    : 'border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                }`}
              >
                &apos;{yrStr}
              </button>
            );
          })}

          {mySeries && !isMySeriesSelected && (
            <button
              type="button"
              onClick={handleSelectMySeries}
              className="ml-1 inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
            >
              <span>⭐</span>
              <span>My: {mySeries.dept}-{String(mySeries.year % 100).padStart(2, '0')}</span>
            </button>
          )}
        </div>

        {/* Show Everything toggle */}
        <div className="flex items-center gap-2">
          <label className="relative inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-700 select-none dark:text-zinc-300">
            <input
              type="checkbox"
              checked={filter.showEverything}
              onChange={(e) => onChange({ ...filter, showEverything: e.target.checked })}
              className="sr-only peer"
            />
            <div className="peer h-5 w-9 rounded-full bg-zinc-300 peer-focus:ring-2 peer-focus:ring-indigo-500/50 peer-checked:bg-indigo-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:bg-zinc-700 dark:after:border-zinc-600"></div>
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              Show Everything
            </span>
            <span className="hidden text-[11px] text-zinc-500 sm:inline dark:text-zinc-400">
              (Classes included)
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
