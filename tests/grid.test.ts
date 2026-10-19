import { describe, expect, test } from 'vitest';
import {
  buildMonthGrid,
  holidaysByDate,
  monthKey,
  parseMonthKey,
  parseOffDays,
  shiftMonth,
  todayInDhaka,
} from '@/core/calendar/grid';

describe('buildMonthGrid', () => {
  // [year, month, first cell, last cell]
  test.each([
    [2026, 10, '2026-09-26', '2026-11-06'], // Oct 1 is a Thursday
    [2026, 2, '2026-01-31', '2026-03-13'], // Feb 1 is a Sunday: one leading day
    [2028, 2, '2028-01-29', '2028-03-10'], // leap year
    [2026, 1, '2025-12-27', '2026-02-06'], // crosses the year boundary
  ])('%i-%i spans %s .. %s', (y, m, first, last) => {
    const cells = buildMonthGrid(y, m);
    expect(cells).toHaveLength(42);
    expect(cells[0]!.date).toBe(first);
    expect(cells[0]!.weekday).toBe(6); // Saturday
    expect(cells[41]!.date).toBe(last);
  });

  test('flags in-month days and weekly off days', () => {
    const cells = buildMonthGrid(2028, 2);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(29);
    expect(cells.find((c) => c.date === '2028-02-29')!.inMonth).toBe(true);
    expect(cells.filter((c) => c.isOff).map((c) => c.weekday)).toSatisfy((w: number[]) =>
      w.every((d) => d === 5 || d === 6),
    );
    expect(cells.filter((c) => c.isOff)).toHaveLength(12);
  });

  test('off days are configurable', () => {
    expect(buildMonthGrid(2026, 10, [0]).filter((c) => c.isOff)).toHaveLength(6);
  });
});

describe('month keys', () => {
  test('parse', () => {
    expect(parseMonthKey('2026-10')).toEqual({ year: 2026, month: 10 });
    for (const bad of ['2026-13', '2026-00', '2026-1', 'x', '', null, undefined]) {
      expect(parseMonthKey(bad)).toBeNull();
    }
  });
  test.each([
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-10', 0, '2026-10'],
    ['2026-10', 14, '2027-12'],
  ])('shiftMonth(%s, %i) = %s', (k, d, want) => {
    expect(shiftMonth(k, d)).toBe(want);
  });
  test('monthKey pads', () => expect(monthKey(2026, 3)).toBe('2026-03'));
});

test('parseOffDays', () => {
  expect(parseOffDays('FRI,SAT')).toEqual([5, 6]);
  expect(parseOffDays(' sun , mon ')).toEqual([0, 1]);
  expect(parseOffDays('nonsense')).toEqual([5, 6]);
  expect(parseOffDays(undefined)).toEqual([5, 6]);
});

test('todayInDhaka uses Dhaka time, not UTC', () => {
  // 20:00 UTC is already the next day in Dhaka (UTC+6).
  expect(todayInDhaka(new Date('2026-10-19T20:00:00Z'))).toBe('2026-10-20');
  expect(todayInDhaka(new Date('2026-10-19T05:00:00Z'))).toBe('2026-10-19');
});

test('holidaysByDate covers every day of a multi-day holiday, inclusive', () => {
  const cells = buildMonthGrid(2026, 10);
  const h = { id: 1, startDate: '2026-10-05', endDate: '2026-10-07' };
  const map = holidaysByDate(cells, [h]);
  const hit = [...map].filter(([, v]) => v.length).map(([d]) => d);
  expect(hit).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
});
