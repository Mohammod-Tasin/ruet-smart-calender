import { describe, expect, test } from 'vitest';
import { todayInDhaka } from '@/core/calendar/grid';
import type { JourneyState } from '@/core/journey/journey';
import { trimNote } from '@/lib/format';
import { approxDate, cellText, dayText, rangeText, runningText, semLabel } from '@/lib/journey-ui';

const year = todayInDhaka().slice(0, 4);
const state = (over: Partial<JourneyState>): JourneyState => ({
  status: 'RUNNING',
  semesterNo: 4,
  semesterLabel: '2-2',
  phase: 'EXAM',
  weekNo: 2,
  phaseWeeks: 4,
  onSkippedWeek: false,
  confirmed: true,
  nextMilestone: null,
  nextSemester: null,
  delayWeeks: 0,
  delayReasons: [],
  ...over,
});

describe('vocabulary helpers (docs/phase-13 §1)', () => {
  test.each([
    [
      'final',
      { phase: 'EXAM', weekNo: 2, phaseWeeks: 4 },
      'Final 2/4',
      'Semester Final · week 2 of 4',
    ],
    [
      '5-week final',
      { phase: 'EXAM', weekNo: 5, phaseWeeks: 5 },
      'Final 5/5',
      'Semester Final · week 5 of 5',
    ],
    ['class', { phase: 'CLASS', weekNo: 5, phaseWeeks: 13 }, 'Class 5/13', 'Class week 5 of 13'],
    [
      'mid break',
      { phase: 'MID_BREAK', weekNo: 1, phaseWeeks: 1 },
      'Mid-term break',
      'Mid-term break',
    ],
    ['viva', { phase: 'VIVA', weekNo: 1, phaseWeeks: 1 }, 'Board Viva', 'Board Viva'],
    [
      'break',
      { phase: 'SEMESTER_BREAK', weekNo: 1, phaseWeeks: 1 },
      'Semester break',
      'Semester break',
    ],
    ['holiday week', { onSkippedWeek: true }, 'Holiday', 'Holiday week'],
    ['no data', { status: 'NONE', phase: null }, 'No data', ''],
  ] as const)('%s', (_n, over, cell, long) => {
    expect(cellText(state(over))).toBe(cell);
    expect(runningText(state(over))).toBe(long);
  });

  test('dates: English digits, year only when not the current year', () => {
    expect(dayText(`${year}-11-21`)).toBe('21 Nov');
    expect(dayText('2020-11-21')).toBe('21 Nov 2020');
    expect(rangeText(`${year}-10-17`, `${year}-10-21`)).toBe('17–21 Oct');
    expect(rangeText(`${year}-10-30`, `${year}-11-02`)).toBe('30 Oct – 2 Nov');
    expect(rangeText(`${year}-10-17`, `${year}-10-17`)).toBe('17 Oct');
  });

  test('expected dates say "around", never "~"', () => {
    expect(approxDate(`${year}-11-21`, false)).toBe('around 21 Nov');
    expect(approxDate(`${year}-11-21`, true)).toBe('21 Nov');
  });

  test('semester labels', () => {
    expect([1, 4, 8].map(semLabel)).toEqual(['1-1', '2-2', '4-2']);
  });

  test('trim message', () => {
    expect(trimNote({ startDate: `${year}-10-17`, endDate: `${year}-10-21` }, [4, 5])).toBe(
      'Thursday and Friday are weekly holidays, so we saved 17–21 Oct.',
    );
  });
});

describe('one month style', () => {
  test('Sep, never Sept, in every date helper', async () => {
    const { shortDate, stamp } = await import('@/lib/format');
    expect(dayText(`${year}-09-20`)).toBe('20 Sep');
    expect(rangeText(`${year}-09-20`, `${year}-10-02`)).toBe('20 Sep – 2 Oct');
    expect(shortDate('2026-09-20')).toBe('20 Sep 2026');
    expect(stamp('2026-09-20T10:00:00Z')).toBe('20 Sep 2026');
  });
});
