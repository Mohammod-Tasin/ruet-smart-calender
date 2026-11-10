'use client';
import { useMemo, useSyncExternalStore } from 'react';
import { holidaysByDate, type GridCell } from '@/core/calendar/grid';
import { barRuns, extendWithAdjacentOffDays, widensOverWeekend } from '@/core/calendar/extend';
import { layoutWeek } from '@/core/calendar/lanes';
import { categoryStyle } from '@/lib/categories';
import type { PublicHoliday } from '@/lib/api';
import { audienceText, dateRange, longDate } from '@/lib/format';

const WEEKDAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const STRIPES =
  '[background-image:repeating-linear-gradient(45deg,transparent_0_4px,rgb(255_255_255/0.35)_4px_8px)]';

// Desktop shows 3 lanes of bars per week row, mobile 2; the rest become "+N more".
const query = '(min-width: 640px)';
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(query);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
const useMaxLanes = () =>
  useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(query).matches ? 3 : 2),
    () => 2,
  );

function ariaLabel(c: GridCell, isToday: boolean, list: PublicHoliday[]) {
  let s = longDate(c.date);
  if (isToday) s += ', today';
  if (c.isOff) s += ', weekly off day';
  if (list.length > 0) {
    s += `. ${list.length === 1 ? '1 holiday' : `${list.length} holidays`}: `;
    s += list.map((h) => `${h.title} (${audienceText(h.label)})`).join('; ');
  }
  return s;
}

export function MonthGrid({
  cells,
  holidays,
  today,
  range,
  onCell,
  onCellDown,
  onCellEnter,
}: {
  cells: GridCell[];
  /** Already filtered for the audience being viewed; null while loading */
  holidays: PublicHoliday[] | null;
  today: string;
  range?: { start: string; end: string } | null;
  /** A click on a day, or on a holiday bar (`holidayId`). */
  onCell: (date: string, holidayId: number | string | null) => void;
  onCellDown?: (date: string) => void;
  onCellEnter?: (date: string) => void;
}) {
  const maxLanes = useMaxLanes();
  const byDate = useMemo(
    () => (holidays ? holidaysByDate(cells, holidays) : null),
    [cells, holidays],
  );
  // Display only: bars also cover the Thu/Fri that touch a holiday (faint part). `holidays` is
  // already filtered by the calendar filters, so the widening never shows a hidden holiday.
  const barItems = useMemo(() => {
    const off = [...new Set(cells.filter((c) => c.isOff).map((c) => c.weekday))];
    return (holidays ?? []).map((h) => {
      const e = widensOverWeekend(h.category) ? extendWithAdjacentOffDays(h, off) : h;
      return { id: h.id, startDate: e.startDate, endDate: e.endDate, h };
    });
  }, [cells, holidays]);
  const weeks = useMemo(
    () => Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7)),
    [cells],
  );

  return (
    <div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-zinc-500 sm:text-xs dark:text-zinc-400">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div
        className="flex flex-col gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 select-none dark:border-zinc-800 dark:bg-zinc-800"
        aria-busy={holidays === null}
      >
        {weeks.map((week, wi) => {
          const dates = week.map((c) => c.date);
          const layout = holidays ? layoutWeek(dates, barItems, maxLanes) : null;
          const anyMore = !!layout && layout.more.some((n) => n > 0);
          return (
            <div key={dates[0]} className="relative">
              <div className="absolute inset-0 grid grid-cols-7 gap-px">
                {week.map((c) => {
                  const isToday = c.date === today;
                  const inRange = !!range && range.start <= c.date && c.date <= range.end;
                  return (
                    <button
                      key={c.date}
                      type="button"
                      aria-label={ariaLabel(c, isToday, byDate?.get(c.date) ?? [])}
                      aria-pressed={range ? inRange : undefined}
                      onClick={() => onCell(c.date, null)}
                      onPointerDown={(e) => e.pointerType === 'mouse' && onCellDown?.(c.date)}
                      onPointerEnter={(e) => e.pointerType === 'mouse' && onCellEnter?.(c.date)}
                      className={`flex items-start p-0.5 text-left outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-indigo-500 sm:p-1.5 ${
                        inRange
                          ? 'bg-indigo-100 dark:bg-indigo-950'
                          : c.isOff
                            ? 'bg-zinc-100 dark:bg-zinc-900'
                            : 'bg-white dark:bg-zinc-950'
                      } ${c.inMonth ? '' : 'opacity-45'}`}
                    >
                      <span
                        className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-medium sm:h-6 sm:w-6 sm:text-sm ${
                          isToday ? 'bg-indigo-600 text-white' : ''
                        }`}
                      >
                        {c.day}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Bars sit above the day buttons; only the bars themselves take clicks. */}
              <div className="pointer-events-none relative grid min-h-[4.25rem] auto-rows-[1rem] grid-cols-7 content-start gap-y-0.5 px-0.5 pt-6 pb-1 sm:min-h-24 sm:auto-rows-[1.25rem] sm:pt-7">
                {layout === null
                  ? wi % 2 === 0 && (
                      <span
                        className="animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
                        style={{ gridColumn: '2 / 5', gridRow: 1 }}
                      />
                    )
                  : layout.bars.flatMap((b) => {
                      const h = b.item.h;
                      const start = h.startDate < dates[0]! ? dates[0]! : h.startDate;
                      const style = categoryStyle(h.category);
                      const real = dates.map((d) => d >= h.startDate && d <= h.endDate);
                      const who =
                        h.label === 'ALL' || h.category === 'EXAM' ? '' : audienceText(h.label);
                      return barRuns(real, b.startCol, b.endCol).map(([from, to, faint]) => {
                        const left = from === b.startCol && !b.continuesLeft;
                        const right = to === b.endCol && !b.continuesRight;
                        const text = faint
                          ? ''
                          : `${b.continuesLeft && from === b.startCol ? '◂ ' : ''}${h.category === 'SUSPENDED_WEEK' ? 'Classes suspended' : h.title}${who ? ` · ${who}` : ''}${b.continuesRight && to === b.endCol ? ' ▸' : ''}`;
                        return (
                          <button
                            key={`${h.id}:${b.lane}:${from}`}
                            type="button"
                            aria-label={`${h.title}${who ? `, ${who}` : ''}, ${dateRange(h.startDate, h.endDate)}${h.tentative ? ', expected date' : ''}${faint ? ', weekend' : ''}`}
                            aria-hidden={faint || undefined}
                            tabIndex={faint ? -1 : undefined}
                            onClick={() => onCell(start, h.id)}
                            onPointerDown={(e) => e.stopPropagation()}
                            style={{ gridColumn: `${from + 1} / ${to + 2}`, gridRow: b.lane + 1 }}
                            className={`pointer-events-auto truncate px-1 text-left text-[9px] leading-4 font-medium sm:text-xs sm:leading-5 ${style.solid} ${
                              left ? 'rounded-l' : ''
                            } ${right ? 'rounded-r' : ''} ${faint ? 'opacity-40' : ''} ${
                              h.tentative ? `${STRIPES} border border-dashed border-white/70` : ''
                            }`}
                          >
                            {text}
                          </button>
                        );
                      });
                    })}
                {anyMore &&
                  layout!.more.map((n, col) =>
                    n > 0 ? (
                      <span
                        key={col}
                        className="px-1 text-[9px] leading-4 text-zinc-600 sm:text-xs dark:text-zinc-400"
                        style={{ gridColumn: col + 1, gridRow: layout!.lanes + 1 }}
                      >
                        +{n} more
                      </span>
                    ) : null,
                  )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
