'use client';
import type { GridCell } from '@/core/calendar/grid';
import type { PublicHoliday } from '@/lib/api';
import { longDate } from '@/lib/format';
import { labelColor } from './HolidayCard';

const WEEKDAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const MAX_SLOTS = 2;

const holidayIdOf = (target: EventTarget) =>
  Number((target as HTMLElement).closest('[data-holiday-id]')?.getAttribute('data-holiday-id')) ||
  null;

function ariaLabel(c: GridCell, isToday: boolean, list: PublicHoliday[]) {
  let s = longDate(c.date);
  if (isToday) s += ', today';
  if (c.isOff) s += ', weekly off day';
  if (list.length > 0) {
    s += `. ${list.length === 1 ? '1 holiday' : `${list.length} holidays`}: `;
    s += list.map((h) => `${h.title} (${h.label})`).join('; ');
  }
  return s;
}

export function MonthGrid({
  cells,
  byDate,
  today,
  range,
  onCell,
  onCellDown,
  onCellEnter,
}: {
  cells: GridCell[];
  /** null while loading */
  byDate: Map<string, PublicHoliday[]> | null;
  today: string;
  range?: { start: string; end: string } | null;
  /** A click on a day, or on a holiday chip inside it (`holidayId`). */
  onCell: (date: string, holidayId: number | null) => void;
  onCellDown?: (date: string) => void;
  onCellEnter?: (date: string) => void;
}) {
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
        className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 select-none dark:border-zinc-800 dark:bg-zinc-800"
        aria-busy={byDate === null}
      >
        {cells.map((c, i) => {
          const list = byDate?.get(c.date) ?? [];
          const shown = list.length > MAX_SLOTS ? list.slice(0, MAX_SLOTS - 1) : list;
          const more = list.length - shown.length;
          const isToday = c.date === today;
          const inRange = !!range && range.start <= c.date && c.date <= range.end;
          return (
            <button
              key={c.date}
              type="button"
              aria-label={ariaLabel(c, isToday, list)}
              aria-pressed={range ? inRange : undefined}
              onClick={(e) => onCell(c.date, holidayIdOf(e.target))}
              onPointerDown={(e) =>
                e.pointerType === 'mouse' && !holidayIdOf(e.target) && onCellDown?.(c.date)
              }
              onPointerEnter={(e) => e.pointerType === 'mouse' && onCellEnter?.(c.date)}
              className={`flex min-h-[4.75rem] flex-col gap-0.5 p-0.5 text-left outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-indigo-500 sm:min-h-28 sm:p-1.5 ${
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
              {byDate === null ? (
                c.inMonth && i % 3 === 0 ? (
                  <span className="h-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                ) : null
              ) : (
                <>
                  {shown.map((h) => (
                    <span
                      key={h.id}
                      data-holiday-id={h.id}
                      className={`block truncate rounded px-1 text-[10px] leading-4 font-medium sm:text-xs ${labelColor(h.label)}`}
                    >
                      {h.label}
                    </span>
                  ))}
                  {more > 0 && (
                    <span className="px-1 text-[10px] leading-4 text-zinc-600 sm:text-xs dark:text-zinc-400">
                      +{more} more
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
