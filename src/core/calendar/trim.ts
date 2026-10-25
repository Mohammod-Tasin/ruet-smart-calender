import { addDays, weekdayOf } from './hijri';

export interface DateRange {
  startDate: string;
  endDate: string;
}

/** True when the range starts or ends on a weekly off day (those days are off anyway). */
export const needsTrim = (r: DateRange, offDays: number[]) =>
  offDays.includes(weekdayOf(r.startDate)) || offDays.includes(weekdayOf(r.endDate));

/**
 * Drops leading and trailing weekly off days (Thu/Fri). Days inside the range are kept, so a
 * holiday spanning a weekend stays in one piece. null when every day of the range is a weekly off.
 */
export function trimOffDays(r: DateRange, offDays: number[]): DateRange | null {
  let { startDate, endDate } = r;
  while (startDate <= endDate && offDays.includes(weekdayOf(startDate))) {
    startDate = addDays(startDate, 1);
  }
  while (endDate >= startDate && offDays.includes(weekdayOf(endDate))) {
    endDate = addDays(endDate, -1);
  }
  return startDate <= endDate ? { startDate, endDate } : null;
}
