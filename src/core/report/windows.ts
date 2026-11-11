import { addDays, weekdayOf } from '@/core/calendar/hijri';

export interface ReportWindow {
  start: string;
  end: string;
}

/**
 * Three Saturday-to-Friday weeks. Week 1 starts on the first Saturday AFTER `from` (a Saturday
 * `from` gives the next Saturday), so the present week is never part of the report.
 */
export function reportWindows(from: string): [ReportWindow, ReportWindow, ReportWindow] {
  const first = addDays(from, (6 - weekdayOf(from) + 7) % 7 || 7);
  const week = (k: number) => ({ start: addDays(first, 7 * k), end: addDays(first, 7 * k + 6) });
  return [week(0), week(1), week(2)];
}
