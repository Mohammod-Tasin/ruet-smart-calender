'use client';
import { useEffect, useMemo, useState } from 'react';
import { buildMonthGrid, parseMonthKey, type GridCell } from '@/core/calendar/grid';
import { loadHolidays, loadStructure, type ApiStructure, type PublicHoliday } from './api';

export function useStructure(): { structure: ApiStructure | null; failed: boolean } {
  const [state, setState] = useState<{ structure: ApiStructure | null; failed: boolean }>({
    structure: null,
    failed: false,
  });
  useEffect(() => {
    loadStructure().then(
      (structure) => setState({ structure, failed: false }),
      () => setState({ structure: null, failed: true }),
    );
  }, []);
  return state;
}

/**
 * Holidays for the 42-cell grid of `ym`, with the neighbouring months prefetched.
 * `version` forces a reload (bump it after a write or a retry). `holidays` is null while loading.
 */
export function useMonthHolidays(
  ym: string,
  offDays: number[],
  opts: { bust?: boolean; version?: number } = {},
): { cells: GridCell[]; holidays: PublicHoliday[] | null; failed: boolean } {
  const { year, month } = parseMonthKey(ym)!;
  const cells = useMemo(() => buildMonthGrid(year, month, offDays), [year, month, offDays]);
  const from = cells[0]!.date;
  const to = cells[41]!.date;
  const key = `${from}|${to}|${opts.version ?? 0}`;
  const [res, setRes] = useState<{ key: string; holidays?: PublicHoliday[] } | null>(null);

  useEffect(() => {
    let live = true;
    loadHolidays(from, to, opts.bust).then(
      (holidays) => live && setRes({ key, holidays }),
      () => live && setRes({ key }),
    );
    // Warm the cache for prev / next; errors are ignored here and surface when navigating.
    for (const delta of [-1, 1]) {
      const g = buildMonthGrid(...shift(year, month, delta));
      loadHolidays(g[0]!.date, g[41]!.date, opts.bust).catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [key, from, to, year, month, opts.bust]);

  const current = res?.key === key ? res : null;
  return { cells, holidays: current?.holidays ?? null, failed: !!current && !current.holidays };
}

function shift(year: number, month: number, delta: number): [number, number] {
  const t = new Date(Date.UTC(year, month - 1 + delta, 1));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1];
}
