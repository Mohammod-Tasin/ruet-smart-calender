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

/**
 * Partitions from `from` (e.g. download date "2026-11-13") to the end of the month's last week
 * into RUET academic weeks (Saturday to Friday).
 * If `from` is omitted or not in `ym`, starts on day 1 of the month.
 * The final week runs through the Friday that concludes the month's last academic week.
 */
export function monthWindows(ym: string, from?: string): ReportWindow[] {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) {
    throw new Error(`Invalid month key: ${ym}`);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDate = `${y}-${pad(m)}-${pad(lastDay)}`;
  const lastWd = weekdayOf(lastDate);
  const daysToEnd = lastWd <= 5 ? 5 - lastWd : 6;
  const targetEnd = addDays(lastDate, daysToEnd);

  const monthStart = `${y}-${pad(m)}-01`;
  let cur = from && from.slice(0, 7) === ym && from > monthStart ? from : monthStart;

  const windows: ReportWindow[] = [];
  while (cur <= targetEnd) {
    const start = cur;
    const wd = weekdayOf(cur);
    const daysToFri = wd <= 5 ? 5 - wd : 6;
    const end = addDays(cur, daysToFri);
    windows.push({ start, end });
    cur = addDays(end, 1);
  }
  return windows;
}
