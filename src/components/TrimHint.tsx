'use client';
import { needsTrim, trimOffDays } from '@/core/calendar/trim';
import { isRealDate } from '@/core/validation/holidays-query';

/** Shown when a chosen range starts or ends on a weekly off day (Thu/Fri are off anyway). */
export function TrimHint({
  start,
  end,
  offDays,
  onTrim,
}: {
  start: string;
  end: string;
  offDays: number[];
  onTrim: (r: { startDate: string; endDate: string }) => void;
}) {
  if (!isRealDate(start) || !isRealDate(end) || end < start) return null;
  const range = { startDate: start, endDate: end };
  if (!needsTrim(range, offDays)) return null;
  const trimmed = trimOffDays(range, offDays);
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">
      <span>বৃহস্পতি-শুক্র এমনিতেই ছুটি — বাদ দেবেন?</span>
      {trimmed ? (
        <button
          type="button"
          className="rounded-md border border-sky-400 px-2 py-1 font-medium hover:bg-sky-100 dark:border-sky-700 dark:hover:bg-sky-900"
          onClick={() => onTrim(trimmed)}
        >
          {trimmed.startDate} → {trimmed.endDate}
        </button>
      ) : (
        <span className="text-xs">(পুরো সময়টাই সাপ্তাহিক ছুটি)</span>
      )}
    </p>
  );
}
