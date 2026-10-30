import { describe, expect, test } from 'vitest';
import {
  computeJourney,
  DEFAULT_STRUCTURE,
  type Journey,
  type Position,
} from '@/core/journey/journey';
import { computeTasks, type TaskInput, type TaskSeries } from '@/core/journey/tasks';
import { bulkPositionsSchema, putSettingsSchema } from '@/core/validation/journey';
import { suspendedWeekProblem } from '@/core/calendar/rules';

const journey = (...positions: Position[]): Journey =>
  computeJourney({ positions, structure: DEFAULT_STRUCTURE, isOffDay: () => false });
const exam = (semesterNo: number, weekNo: number, at = '2026-10-24'): Position => ({
  asOfDate: at,
  semesterNo,
  phase: 'EXAM',
  weekNo,
  kind: 'POSITION',
});
const cls = (semesterNo: number, weekNo: number, at = '2026-10-24'): Position => ({
  asOfDate: at,
  semesterNo,
  phase: 'CLASS',
  weekNo,
  kind: 'POSITION',
});
const series = (
  seriesId: number,
  label: string,
  intakeYear: number,
  j: Journey | null,
): TaskSeries => ({
  seriesId,
  label,
  intakeYear,
  journey: j,
});

const input = (over: Partial<TaskInput>): TaskInput => ({
  today: '2026-10-30',
  series: [],
  datesNeeded: [],
  tentative: [],
  ...over,
});

describe('computeTasks: next semester start date', () => {
  test('exam week >= 3 (and the break): grouped by intake and semester, projected date pre-filled', () => {
    const tasks = computeTasks(
      input({
        series: [
          series(1, 'CSE-23', 2023, journey(exam(4, 3))),
          series(2, 'EEE-23', 2023, journey(exam(4, 3))),
          series(3, 'ME-23', 2023, journey(exam(4, 2))), // exam week 2: too early
          series(4, 'CSE-24', 2024, journey(exam(2, 4))),
        ],
      }),
    );
    expect(tasks).toHaveLength(2);
    // Earliest projected start first: 2024 (exam 4 on 24 Oct -> break 31 Oct -> 2-2 on 7 Nov),
    // then 2023 (exam 3 on 24 Oct -> exam 4 31 Oct -> break 7 Nov -> 3-1 on 14 Nov).
    const [a, b] = tasks as Extract<(typeof tasks)[number], { type: 'NEXT_SEMESTER_START' }>[];
    expect(a).toMatchObject({ intakeYear: 2024, semesterNo: 3, projectedStart: '2026-11-07' });
    expect(b).toMatchObject({
      type: 'NEXT_SEMESTER_START',
      intakeYear: 2023,
      semesterNo: 5, // 3-1
      projectedStart: '2026-11-14',
      uniform: true,
      overdue: false,
    });
    expect(b!.items.map((i) => i.label)).toEqual(['CSE-23', 'EEE-23']);
  });

  test('not asked when the next semester already has a start date', () => {
    const j = journey(exam(4, 3), {
      asOfDate: '2026-11-21',
      semesterNo: 5,
      phase: 'CLASS',
      weekNo: 1,
      kind: 'SEMESTER_START',
    });
    expect(computeTasks(input({ series: [series(1, 'CSE-23', 2023, j)] }))).toEqual([]);
  });

  test('not asked for 4-2 (graduation, no next semester) or for a running confirmed class week', () => {
    expect(
      computeTasks(input({ series: [series(1, 'CSE-21', 2021, journey(exam(8, 4)))] })),
    ).toEqual([]);
    expect(
      computeTasks(input({ series: [series(1, 'CSE-24', 2024, journey(cls(3, 5)))] })),
    ).toEqual([]);
  });

  test('turns overdue once the projected start has passed, and sorts first', () => {
    // 2-2 break was 14 Nov, 3-1 projected 21 Nov. Today is 25 Nov: it started on its own.
    const late = series(1, 'CSE-23', 2023, journey(exam(4, 2)));
    const soon = series(2, 'CSE-24', 2024, journey(exam(2, 4, '2026-11-28')));
    const tasks = computeTasks(input({ today: '2026-11-25', series: [soon, late] }));
    expect(tasks[0]).toMatchObject({
      type: 'NEXT_SEMESTER_START',
      intakeYear: 2023,
      overdue: true,
    });
    expect(tasks[1]).toMatchObject({ intakeYear: 2024, overdue: false });
  });

  test('a series projecting different dates is not "uniform"', () => {
    const tasks = computeTasks(
      input({
        series: [
          series(1, 'CSE-23', 2023, journey(exam(4, 3))),
          series(2, 'EEE-23', 2023, journey(exam(4, 4, '2026-10-24'))),
        ],
      }),
    );
    expect(tasks[0]).toMatchObject({ uniform: false });
  });
});

describe('computeTasks: the other tasks and priority order', () => {
  const tentative = [
    { ruleId: 9, year: 2026, title: 'Eid', startDate: '2026-11-20' },
    { ruleId: 10, year: 2027, title: 'Far', startDate: '2026-12-31' }, // > 30 days
    { ruleId: 11, year: 2026, title: 'Past', startDate: '2026-10-01' }, // past
  ];
  const datesNeeded = [
    { year: 2026, rules: [{ id: 1, title: 'Sanatani Holiday' }] },
    {
      year: 2027,
      rules: [
        { id: 1, title: 'Sanatani Holiday' },
        { id: 2, title: 'Summer' },
      ],
    },
  ];

  test('no data: intake >= this year is a new batch; older ones (even 2025) just need a status', () => {
    const tasks = computeTasks(
      input({
        series: [
          series(1, 'CSE-26', 2026, null),
          series(2, 'EEE-26', 2026, null),
          series(
            3,
            'CSE-25',
            2025,
            computeJourney({ positions: [], structure: DEFAULT_STRUCTURE, isOffDay: () => false }),
          ),
        ],
      }),
    );
    expect(tasks).toEqual([
      { type: 'SET_STATUS', seriesIds: [3], labels: ['CSE-25'] },
      { type: 'NEW_BATCH', intakeYear: 2026, seriesIds: [1, 2], labels: ['CSE-26', 'EEE-26'] },
    ]);
  });

  test('2025 without data never gets the 1-1 date task, not even in 2026', () => {
    const tasks = computeTasks(input({ series: [series(3, 'CSE-25', 2025, null)] }));
    expect(tasks).toEqual([{ type: 'SET_STATUS', seriesIds: [3], labels: ['CSE-25'] }]);
  });

  test('yearly dates only from Nov 1', () => {
    expect(computeTasks(input({ today: '2026-10-31', datesNeeded }))).toEqual([]);
    const tasks = computeTasks(input({ today: '2026-11-01', datesNeeded }));
    expect(tasks.map((t) => t.type === 'YEARLY_DATES' && t.year)).toEqual([2026, 2027]);
  });

  test('moon sighting: only tentative days starting within 30 days', () => {
    const tasks = computeTasks(input({ tentative }));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ type: 'CONFIRM_MOON' });
    expect((tasks[0] as { items: unknown[] }).items).toHaveLength(1);
  });

  test('priority: semester start, new batch, yearly dates, moon sighting', () => {
    const tasks = computeTasks(
      input({
        today: '2026-11-02',
        series: [series(1, 'CSE-23', 2023, journey(exam(4, 3))), series(2, 'CSE-26', 2026, null)],
        datesNeeded,
        tentative: [{ ruleId: 9, year: 2026, title: 'Eid', startDate: '2026-11-20' }],
      }),
    );
    expect(tasks.map((t) => t.type)).toEqual([
      'NEXT_SEMESTER_START',
      'NEW_BATCH',
      'YEARLY_DATES',
      'YEARLY_DATES',
      'CONFIRM_MOON',
    ]);
  });

  test('nothing to do -> empty list', () => {
    expect(computeTasks(input({}))).toEqual([]);
  });
});

describe('validation', () => {
  const base = { seriesIds: [1, 2], asOfDate: '2026-10-24', semesterNo: 4 };

  test('POSITION needs phase and weekNo; SEMESTER_START does not', () => {
    expect(bulkPositionsSchema.safeParse({ ...base, kind: 'POSITION' }).success).toBe(false);
    expect(
      bulkPositionsSchema.safeParse({ ...base, kind: 'POSITION', phase: 'EXAM', weekNo: 2 })
        .success,
    ).toBe(true);
    expect(bulkPositionsSchema.safeParse({ ...base, kind: 'SEMESTER_START' }).success).toBe(true);
  });

  test.each([
    [{ semesterNo: 0 }],
    [{ semesterNo: 9 }],
    [{ asOfDate: '2026-02-30' }],
    [{ seriesIds: [] }],
    [{ seriesIds: [1, 1] }],
    [{ phase: 'FINALS' }],
  ])('rejects %j', (bad) => {
    expect(
      bulkPositionsSchema.safeParse({ ...base, kind: 'POSITION', phase: 'EXAM', weekNo: 2, ...bad })
        .success,
    ).toBe(false);
  });

  test('settings: needs CLASS and EXAM blocks', () => {
    expect(putSettingsSchema.safeParse({ structure: DEFAULT_STRUCTURE }).success).toBe(true);
    expect(
      putSettingsSchema.safeParse({ structure: [{ phase: 'CLASS', weeks: 7, extendable: true }] })
        .success,
    ).toBe(false);
  });

  test.each([
    ['2026-11-07', '2026-11-11', null], // Sat..Wed
    ['2026-11-07', '2026-11-12', 'x'], // Thursday end
    ['2026-11-08', '2026-11-12', 'x'], // starts Sunday
    ['2026-11-07', '2026-11-07', 'x'], // one day
  ])('suspended week %s..%s', (s, e, bad) => {
    const r = suspendedWeekProblem({ category: 'SUSPENDED_WEEK', startDate: s, endDate: e });
    expect(r === null).toBe(bad === null);
    expect(suspendedWeekProblem({ category: 'HOLIDAY', startDate: s, endDate: e })).toBeNull();
  });
});
