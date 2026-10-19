const DAY_MS = 86_400_000;
const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export interface GridCell {
  date: string; // "YYYY-MM-DD"
  day: number;
  inMonth: boolean;
  weekday: number; // 0 = Sunday ... 6 = Saturday (JS getUTCDay)
  isOff: boolean; // weekly off day (config, not a holiday row)
}

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (t: Date) =>
  `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;

/** "FRI,SAT" -> [5, 6]. Falls back to Fri/Sat when empty or unreadable. */
export function parseOffDays(value: string | undefined): number[] {
  const days = (value ?? '')
    .split(',')
    .map((s) => DAY_CODES.indexOf(s.trim().toUpperCase()))
    .filter((i) => i >= 0);
  return days.length > 0 ? days : [5, 6];
}

/** 6 weeks x 7 days = 42 cells, week starts Saturday. `month` is 1-12. UTC maths: no time zones. */
export function buildMonthGrid(
  year: number,
  month: number,
  offDays: number[] = [5, 6],
): GridCell[] {
  const first = Date.UTC(year, month - 1, 1);
  const start = first - ((new Date(first).getUTCDay() + 1) % 7) * DAY_MS; // back to the Saturday
  return Array.from({ length: 42 }, (_, i) => {
    const t = new Date(start + i * DAY_MS);
    return {
      date: toIso(t),
      day: t.getUTCDate(),
      inMonth: t.getUTCMonth() === month - 1,
      weekday: t.getUTCDay(),
      isOff: offDays.includes(t.getUTCDay()),
    };
  });
}

export const monthKey = (year: number, month: number) => `${year}-${pad(month)}`;

/** "2026-10" -> { year: 2026, month: 10 }, or null. */
export function parseMonthKey(
  s: string | null | undefined,
): { year: number; month: number } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s ?? '');
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

export function shiftMonth(key: string, delta: number): string {
  const { year, month } = parseMonthKey(key)!;
  const t = new Date(Date.UTC(year, month - 1 + delta, 1));
  return monthKey(t.getUTCFullYear(), t.getUTCMonth() + 1);
}

/** Today's date in the business time zone (Asia/Dhaka), "YYYY-MM-DD". */
export function todayInDhaka(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(now);
}

/** For each cell date, the holidays covering it. */
export function holidaysByDate<T extends { startDate: string; endDate: string }>(
  cells: GridCell[],
  holidays: T[],
): Map<string, T[]> {
  return new Map(
    cells.map((c) => [
      c.date,
      holidays.filter((h) => h.startDate <= c.date && c.date <= h.endDate),
    ]),
  );
}
