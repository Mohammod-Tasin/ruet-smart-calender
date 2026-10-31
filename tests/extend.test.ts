import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { extendWithAdjacentOffDays } from '@/core/calendar/extend';
import { addDays, weekdayOf } from '@/core/calendar/hijri';
import { findOverlaps } from '@/core/calendar/overlap';
import type { Structure } from '@/core/calendar/types';
import { computeJourney, DEFAULT_STRUCTURE } from '@/core/journey/journey';

const OFF = [4, 5]; // Thu, Fri
const r = (startDate: string, endDate: string) => ({ startDate, endDate });

describe('extendWithAdjacentOffDays', () => {
  test('the test dates are what we think they are', () => {
    expect(weekdayOf('2026-10-17')).toBe(6); // Saturday
    expect(weekdayOf('2026-10-21')).toBe(3); // Wednesday
  });

  test.each([
    [
      'Sat-Wed holiday takes both weekends',
      r('2026-10-17', '2026-10-21'),
      r('2026-10-15', '2026-10-23'),
    ],
    [
      'already covers the weekend: unchanged',
      r('2026-10-15', '2026-10-23'),
      r('2026-10-15', '2026-10-23'),
    ],
    [
      'starts Sunday: Saturday is not off, no lead-in',
      r('2026-10-18', '2026-10-21'),
      r('2026-10-18', '2026-10-23'),
    ],
    [
      'ends Tuesday: Wednesday is not off, no tail',
      r('2026-10-17', '2026-10-20'),
      r('2026-10-15', '2026-10-20'),
    ],
    [
      'one Wednesday gets Thu+Fri after it',
      r('2026-10-21', '2026-10-21'),
      r('2026-10-21', '2026-10-23'),
    ],
    ['mid-week day touches nothing', r('2026-10-19', '2026-10-19'), r('2026-10-19', '2026-10-19')],
  ])('%s', (_n, input, expected) => {
    expect(extendWithAdjacentOffDays(input, OFF)).toEqual(expected);
  });

  test('never extends past the weekly off days', () => {
    const e = extendWithAdjacentOffDays(r('2026-10-17', '2026-10-21'), OFF);
    expect(weekdayOf(addDays(e.startDate, -1))).toBe(3); // Wednesday before, untouched
    expect(weekdayOf(addDays(e.endDate, 1))).toBe(6); // Saturday after, untouched
  });

  test('every day off: stops instead of looping', () => {
    const e = extendWithAdjacentOffDays(r('2026-10-17', '2026-10-17'), [0, 1, 2, 3, 4, 5, 6]);
    expect(e.startDate).toBe('2026-10-10');
    expect(e.endDate).toBe('2026-10-24');
  });
});

describe('the weekend extension is display only', () => {
  const structure: Structure = {
    faculties: [{ id: 1, code: 'F', sortOrder: 1 }],
    departments: [{ id: 1, facultyId: 1, code: 'CSE' }],
    series: [{ id: 123, departmentId: 1, intakeYear: 2023, isActive: true }],
  };
  const all = [{ scopeType: 'ALL' as const, scopeId: null }];
  const sanatani = { id: 1, ...r('2026-10-17', '2026-10-21'), audience: all };

  test('overlap check uses the saved dates', () => {
    const next = { ...r('2026-10-22', '2026-10-23'), audience: all }; // Thu-Fri right after
    // Drawn together (the bar reaches 23 Oct) ...
    expect(extendWithAdjacentOffDays(sanatani, OFF).endDate).toBe('2026-10-23');
    // ... but they do not overlap.
    expect(findOverlaps(next, [sanatani], structure)).toEqual([]);
  });

  test('the journey is the same with or without the weekend days', () => {
    const e = extendWithAdjacentOffDays(sanatani, OFF);
    const has = (a: { startDate: string; endDate: string }) => (d: string) =>
      d >= a.startDate && d <= a.endDate;
    const run = (isOffDay: (d: string) => boolean) =>
      computeJourney({
        positions: [
          { asOfDate: '2026-10-24', semesterNo: 4, phase: 'EXAM', weekNo: 2, kind: 'POSITION' },
        ],
        structure: DEFAULT_STRUCTURE,
        isOffDay,
      });
    expect(run(has(e))).toEqual(run(has(sanatani)));
  });

  test('only UI code imports it (overlap, journey/impact and services never do)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const guarded = [...walk('src/core'), ...walk('src/server'), ...walk('src/app/api')].filter(
      (f) => !f.endsWith('extend.ts'),
    );
    const offenders = guarded.filter((f) =>
      /extend['"]|extendWithAdjacentOffDays/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
