import { describe, expect, test } from 'vitest';
import { addDays, weekdayOf } from '@/core/calendar/hijri';
import {
  computeJourney,
  DEFAULT_STRUCTURE,
  stateOn,
  type Journey,
  type JourneyStructure,
  type Position,
} from '@/core/journey/journey';
import {
  fieldsFromStructure,
  scheduleProblem,
  structureFromFields,
  type ScheduleFields,
} from '@/core/journey/schedule';
import { computeTasks, type TaskSeries } from '@/core/journey/tasks';

const DEFAULTS: ScheduleFields = { classesBefore: 7, classesAfter: 6, vivaWeeks: 1, finalWeeks: 4 };
const EIGHT_FIVE: ScheduleFields = { ...DEFAULTS, classesBefore: 8, classesAfter: 5 };

// A Saturday; semester 7 (4-1) starts here.
const S = '2026-07-04';
const start = (semesterNo: number, asOfDate: string): Position => ({
  asOfDate,
  semesterNo,
  phase: 'CLASS',
  weekNo: 1,
  kind: 'SEMESTER_START',
});
const run = (over: Record<number, ScheduleFields>, positions = [start(7, S)]): Journey =>
  computeJourney({
    positions,
    structure: DEFAULT_STRUCTURE,
    structureFor: (n) => (over[n] ? structureFromFields(over[n]!) : undefined),
    isOffDay: () => false,
  });
const sem = (j: Journey, n: number) => j.semesters.find((x) => x.semesterNo === n)!;
const weeks = (n: number, from = S) => addDays(from, n * 7);

describe('schedule fields', () => {
  test('the dates used below are Saturdays', () => {
    expect(weekdayOf(S)).toBe(6);
  });

  test('the default structure is 7 + 6 classes, 1 viva, 4 final', () => {
    expect(fieldsFromStructure(DEFAULT_STRUCTURE)).toEqual(DEFAULTS);
    expect(structureFromFields(DEFAULTS)).toEqual(DEFAULT_STRUCTURE);
  });

  test('a structure that is not the default shape has no fields', () => {
    const odd: JourneyStructure = [{ phase: 'EXAM', weeks: 2, extendable: true }];
    expect(fieldsFromStructure(odd)).toBeNull();
  });

  test.each([
    ['default', DEFAULTS, null],
    ['8 + 5', EIGHT_FIVE, null],
    ['no classes after the break', { ...DEFAULTS, classesBefore: 13, classesAfter: 0 }, null],
    ['20 class weeks is the most', { ...DEFAULTS, classesBefore: 10, classesAfter: 10 }, null],
    ['21 class weeks', { ...DEFAULTS, classesBefore: 11, classesAfter: 10 }, 'between 1 and 20'],
    ['no class weeks', { ...DEFAULTS, classesBefore: 0, classesAfter: 0 }, 'between 1 and 20'],
    ['negative', { ...DEFAULTS, classesBefore: -1 }, 'whole numbers'],
    ['fraction', { ...DEFAULTS, finalWeeks: 2.5 }, 'whole numbers'],
    ['no final', { ...DEFAULTS, finalWeeks: 0 }, '1 to 8'],
    ['9 final weeks', { ...DEFAULTS, finalWeeks: 9 }, '1 to 8'],
    ['8 final weeks', { ...DEFAULTS, finalWeeks: 8 }, null],
    ['no viva is fine', { ...DEFAULTS, vivaWeeks: 0 }, null],
  ])('validation: %s', (_n, f, problem) => {
    const got = scheduleProblem(f);
    if (problem) expect(got).toContain(problem);
    else expect(got).toBeNull();
  });
});

describe('journey with a per-semester schedule', () => {
  test('default: the mid-term break is after class week 7, class week 8 follows it', () => {
    const j = run({});
    expect(sem(j, 7).midBreakStart).toBe(weeks(7));
    expect(stateOn(j, weeks(8)).weekNo).toBe(8);
  });

  test('8 + 5: the break is after week 8 and class week 9 is the first after it', () => {
    const j = run({ 7: EIGHT_FIVE });
    expect(sem(j, 7).midBreakStart).toBe(weeks(8));
    expect(stateOn(j, weeks(7))).toMatchObject({ phase: 'CLASS', weekNo: 8 });
    expect(stateOn(j, weeks(8))).toMatchObject({ phase: 'MID_BREAK' });
    expect(stateOn(j, weeks(9))).toMatchObject({ phase: 'CLASS', weekNo: 9 });
  });

  test('8 + 5 keeps 13 class weeks, so the rest of the semester does not move', () => {
    expect(sem(run({ 7: EIGHT_FIVE }), 8).classStart).toBe(sem(run({}), 8).classStart);
  });

  test('"Class 9 of 13" and "Final N of M" use that semester\'s numbers', () => {
    const j = run({ 7: { ...EIGHT_FIVE, finalWeeks: 3 } });
    expect(stateOn(j, weeks(9))).toMatchObject({ phase: 'CLASS', weekNo: 9, phaseWeeks: 13 });
    const finalWeek = sem(j, 7).examStart!;
    expect(stateOn(j, finalWeek)).toMatchObject({ phase: 'EXAM', weekNo: 1, phaseWeeks: 3 });
  });

  test('an override does not leak into the next semester', () => {
    const j = run({ 7: { classesBefore: 6, classesAfter: 6, vivaWeeks: 1, finalWeeks: 3 } });
    // 7 is one class week and one final week shorter, so 8 starts 2 weeks earlier ...
    expect(sem(j, 8).classStart).toBe(weeks(18));
    // ... and 8 itself still uses the default (break after week 7, 4 final weeks).
    expect(sem(j, 8).midBreakStart).toBe(weeks(18 + 7));
    expect(stateOn(j, sem(j, 8).examStart!).phaseWeeks).toBe(4);
  });

  test('an override on the next semester does not touch the earlier one', () => {
    const j = run({ 8: EIGHT_FIVE });
    expect(sem(j, 7).midBreakStart).toBe(weeks(7));
    expect(sem(j, 8).midBreakStart).toBe(weeks(20 + 8));
  });

  test("a saved position is read with the semester's own schedule", () => {
    // "Class week 8" on 8 + 5 is the last week BEFORE the break.
    const pos: Position = {
      asOfDate: weeks(7),
      semesterNo: 7,
      phase: 'CLASS',
      weekNo: 8,
      kind: 'POSITION',
    };
    const j = run({ 7: EIGHT_FIVE }, [pos]);
    expect(stateOn(j, weeks(8))).toMatchObject({ phase: 'MID_BREAK' });
  });
});

describe('computeTasks: MID_BREAK_CHECK', () => {
  const journeyAt = (from: string) =>
    computeJourney({
      positions: [start(7, from)],
      structure: DEFAULT_STRUCTURE,
      isOffDay: () => false,
    });
  const mk = (id: number, label: string, from = S, breakChecked?: number[]): TaskSeries => ({
    seriesId: id,
    label,
    intakeYear: 2023,
    journey: journeyAt(from),
    breakChecked,
  });
  const M = weeks(7); // expected mid-term break start
  const checks = (today: string, series: TaskSeries[]) =>
    computeTasks({ today, series, datesNeeded: [], tentative: [] }).filter(
      (t) => t.type === 'MID_BREAK_CHECK',
    );

  test('the break start is a Saturday', () => {
    expect(weekdayOf(M)).toBe(6);
  });

  test.each([
    [addDays(M, -15), 0],
    [addDays(M, -14), 1], // exactly 14 days before
    [addDays(M, -1), 1],
    [M, 0], // the day the break starts
    [addDays(M, 3), 0],
  ])('today %s -> %i card(s)', (today, n) => {
    expect(checks(today, [mk(1, 'CSE-23')])).toHaveLength(n);
  });

  test('the card says when and after which class week', () => {
    expect(checks(addDays(M, -14), [mk(1, 'CSE-23')])[0]).toMatchObject({
      intakeYear: 2023,
      semesterNo: 7,
      expectedStart: M,
      afterClassWeek: 7,
    });
  });

  test('confirmed or changed semesters give no card', () => {
    expect(checks(addDays(M, -10), [mk(1, 'CSE-23', S, [7])])).toHaveLength(0);
  });

  test('grouped by batch, semester and start date', () => {
    const later = addDays(S, 7); // one department started a week later
    const t = checks(addDays(M, -3), [mk(1, 'CSE-23'), mk(2, 'EEE-23'), mk(3, 'ME-23', later)]);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ expectedStart: M });
    expect((t[0] as { items: unknown[] }).items).toHaveLength(2);
    expect(t[1]).toMatchObject({ expectedStart: addDays(M, 7) });
  });

  test('only the unanswered series stay in a group', () => {
    const t = checks(addDays(M, -3), [mk(1, 'CSE-23'), mk(2, 'EEE-23', S, [7])]);
    expect((t[0] as { items: { label: string }[] }).items.map((i) => i.label)).toEqual(['CSE-23']);
  });
});
