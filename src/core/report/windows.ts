import { addDays } from '@/core/calendar/hijri';

export interface ReportWindow {
  start: string;
  end: string;
}

/** The client's exact windows: D..D+7, D+8..D+14, D+15..D+21 (all inclusive). */
export function reportWindows(from: string): [ReportWindow, ReportWindow, ReportWindow] {
  return [
    { start: from, end: addDays(from, 7) },
    { start: addDays(from, 8), end: addDays(from, 14) },
    { start: addDays(from, 15), end: addDays(from, 21) },
  ];
}
