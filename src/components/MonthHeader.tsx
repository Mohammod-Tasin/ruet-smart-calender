import { parseMonthKey } from '@/core/calendar/grid';
import { monthTitle } from '@/lib/format';

export function MonthHeader({
  ym,
  onPrev,
  onNext,
  onToday,
  hideNavOnMobile = false,
}: {
  ym: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  hideNavOnMobile?: boolean;
}) {
  const { year, month } = parseMonthKey(ym)!;
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <h2 aria-live="polite" className="text-base font-semibold sm:text-xl">
        {monthTitle(year, month)}
      </h2>
      <div className={`items-center gap-1.5 sm:gap-2 ${hideNavOnMobile ? 'hidden sm:flex' : 'flex'}`}>
        <button
          type="button"
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 sm:px-3 sm:py-1.5 sm:text-sm dark:border-zinc-700 dark:hover:bg-zinc-800"
          onClick={onToday}
        >
          Today
        </button>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 text-sm font-semibold hover:bg-zinc-100 sm:h-8 sm:w-8 sm:text-base dark:border-zinc-700 dark:hover:bg-zinc-800"
          onClick={onPrev}
          aria-label="Previous month"
        >
          ‹
        </button>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 text-sm font-semibold hover:bg-zinc-100 sm:h-8 sm:w-8 sm:text-base dark:border-zinc-700 dark:hover:bg-zinc-800"
          onClick={onNext}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
    </div>
  );
}
