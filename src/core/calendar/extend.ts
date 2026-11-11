import { addDays, weekdayOf } from './hijri';
import type { DateRange } from './trim';

/**
 * DISPLAY ONLY. Widens a holiday over the weekly off days (Thu/Fri) that directly touch it, so
 * 17-21 Oct is drawn as 15-23 Oct. Never use this for overlap checks, impact or the journey:
 * those read the saved dates (tests/extend.test.ts guards that).
 */
export function extendWithAdjacentOffDays(r: DateRange, offDays: number[]): DateRange {
  let { startDate, endDate } = r;
  for (let i = 0; i < 7 && offDays.includes(weekdayOf(addDays(startDate, -1))); i++) {
    startDate = addDays(startDate, -1);
  }
  for (let i = 0; i < 7 && offDays.includes(weekdayOf(addDays(endDate, 1))); i++) {
    endDate = addDays(endDate, 1);
  }
  return { startDate, endDate };
}

/** Study phases (exam strips, class weeks, board viva) are not days off, so no Thu/Fri lead-in. */
const STUDY_CATEGORIES = new Set(['EXAM', 'CLASS', 'VIVA']);
export const widensOverWeekend = (category: string) => !STUDY_CATEGORIES.has(category);

/**
 * DISPLAY ONLY. One week row of a bar, as [fromCol, toCol, faint] runs: the weekly-off lead-in,
 * the real holiday, the weekly-off tail (faint). `real[c]` = day c is inside the saved dates.
 */
export function barRuns(
  real: boolean[],
  startCol: number,
  endCol: number,
): [number, number, boolean][] {
  const cols = Array.from({ length: endCol - startCol + 1 }, (_, i) => startCol + i);
  const first = cols.findIndex((c) => real[c]);
  const lastReal = cols.findLastIndex((c) => real[c]);
  if (first < 0) return [[startCol, endCol, true]];
  const runs: [number, number, boolean][] = [];
  if (first > 0) runs.push([startCol, cols[first - 1]!, true]);
  runs.push([cols[first]!, cols[lastReal]!, false]);
  if (lastReal < cols.length - 1) runs.push([cols[lastReal + 1]!, endCol, true]);
  return runs;
}
