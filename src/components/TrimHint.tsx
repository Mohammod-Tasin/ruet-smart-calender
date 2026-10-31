'use client';
import { needsTrim, trimOffDays } from '@/core/calendar/trim';
import { isRealDate } from '@/core/validation/holidays-query';
import { extendWithAdjacentOffDays } from '@/core/calendar/extend';
import { rangeText } from '@/lib/journey-ui';
import { trimNote, weekendNote } from '@/lib/format';

/**
 * Shown while typing a range that starts or ends on a weekly off day (Thu/Fri). Nothing to click:
 * the server trims those days when it saves (and the form shows the same line after saving).
 */
export function TrimHint({
  start,
  end,
  offDays,
}: {
  start: string;
  end: string;
  offDays: number[];
}) {
  if (!isRealDate(start) || !isRealDate(end) || end < start) return null;
  const range = { startDate: start, endDate: end };
  const trimmed = trimOffDays(range, offDays);
  if (!needsTrim(range, offDays)) {
    const note = weekendNote(range, offDays);
    return note && <Box>{note}</Box>;
  }
  const shown = trimmed && extendWithAdjacentOffDays(trimmed, offDays);
  return (
    <Box>
      {trimmed
        ? `${trimNote(trimmed, offDays, 'will save')} The calendar still shows ${rangeText(shown!.startDate, shown!.endDate)} as off.`
        : 'These days are all weekly holidays (Thursday and Friday), so there is nothing to save.'}
    </Box>
  );
}

const Box = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">
    {children}
  </p>
);
