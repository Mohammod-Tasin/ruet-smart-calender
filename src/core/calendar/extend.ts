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
