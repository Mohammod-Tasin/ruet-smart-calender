'use client';
import { useMemo, useSyncExternalStore } from 'react';
import { holidaysByDate, type GridCell } from '@/core/calendar/grid';
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
  const weeks = useMemo(
    () => Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7)),
    [cells],
  );

  return (
    <div>
      <div className="grid grid-cols-7 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400">
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
          const layout = holidays ? layoutWeek(dates, holidays, maxLanes) : null;
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
                        className={`grid h-6 w-6 place-items-center rounded-full text-xs font-medium sm:text-sm ${
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
              <div className="pointer-events-none relative grid min-h-[4.5rem] auto-rows-[1rem] grid-cols-7 content-start gap-y-0.5 px-0.5 pt-7 pb-1 sm:min-h-24 sm:auto-rows-[1.25rem]">
                {layout === null
                  ? wi % 2 === 0 && (
                      <span
                        className="animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
                        style={{ gridColumn: '2 / 5', gridRow: 1 }}
                      />
                    )
                  : layout.bars.map((b) => {
                      const h = b.item;
                      const start = h.startDate < dates[0]! ? dates[0]! : h.startDate;
                      const style = categoryStyle(h.category);
                      const text = `${b.continuesLeft ? '◂ ' : ''}${audienceText(h.label)} · ${h.category === 'SUSPENDED_WEEK' ? 'Classes suspended' : h.title}${b.continuesRight ? ' ▸' : ''}`;
                      return (
                        <button
                          key={h.id}
                          type="button"
                          aria-label={`${h.title}, ${audienceText(h.label)}, ${dateRange(h.startDate, h.endDate)}${h.tentative ? ', expected date' : ''}`}
                          onClick={() => onCell(start, h.id)}
                          onPointerDown={(e) => e.stopPropagation()}
                          style={{
                            gridColumn: `${b.startCol + 1} / ${b.endCol + 2}`,
                            gridRow: b.lane + 1,
                          }}
                          className={`pointer-events-auto truncate px-1 text-left text-[9px] leading-4 font-medium text-white sm:text-xs sm:leading-5 ${style.solid} ${
                            b.continuesLeft ? '' : 'rounded-l'
                          } ${b.continuesRight ? '' : 'rounded-r'} ${
                            h.tentative ? `${STRIPES} border border-dashed border-white/70` : ''
                          }`}
                        >
                          {text}
                        </button>
                      );
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
