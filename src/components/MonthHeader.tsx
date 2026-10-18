import { parseMonthKey } from '@/core/calendar/grid';
import { monthTitle } from '@/lib/format';

const btn =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800';

export function MonthHeader({
  ym,
  onPrev,
  onNext,
  onToday,
}: {
  ym: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const { year, month } = parseMonthKey(ym)!;
  return (
    <div className="flex items-center gap-2">
      <h2 aria-live="polite" className="mr-auto text-lg font-semibold sm:text-xl">
        {monthTitle(year, month)}
      </h2>
      <button type="button" className={btn} onClick={onToday}>
        Today
      </button>
      <button type="button" className={btn} onClick={onPrev} aria-label="Previous month">
        ‹
      </button>
      <button type="button" className={btn} onClick={onNext} aria-label="Next month">
        ›
      </button>
    </div>
  );
}
