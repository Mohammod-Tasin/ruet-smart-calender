import { describe, expect, test } from 'vitest';
import { addDays } from '@/core/calendar/hijri';
import { expandRules, type RuleDef, type RuleOverride } from '@/core/calendar/rules';
import { SEED_RULES } from '@/core/calendar/seed-rules';
import { diffJourneys } from '@/core/journey/impact';
import {
  buildSlots,
  computeJourney,
  DEFAULT_STRUCTURE,
  delayReasons,
  semesterLabel,
  stateOn,
  weekStartOf,
  type JourneyInput,
  type Position,
} from '@/core/journey/journey';

/** Off days from inclusive [start, end] ranges. */
const offOf = (...ranges: [string, string][]) => {
  const has = (d: string) => ranges.some(([s, e]) => s <= d && d <= e);
  return { isOffDay: has, titlesOn: (d: string) => (has(d) ? ['Holiday'] : []) };
};
const run = (positions: Position[], over: Partial<JourneyInput> = {}) =>
  computeJourney({ positions, structure: DEFAULT_STRUCTURE, ...offOf(), ...over });

const pos = (
  asOfDate: string,
  semesterNo: number,
  phase: Position['phase'],
  weekNo: number,
  kind: Position['kind'] = 'POSITION',
): Position => ({ asOfDate, semesterNo, phase, weekNo, kind });
const start = (asOfDate: string, semesterNo = 1) =>
  pos(asOfDate, semesterNo, 'CLASS', 1, 'SEMESTER_START');

const skipped = (j: ReturnType<typeof run>) =>
  j.weeks.filter((w) => w.status === 'SKIPPED').map((w) => w.weekStart);
const at = (j: ReturnType<typeof run>, weekStart: string) =>
  j.weeks.find((w) => w.weekStart === weekStart);

// The real seeded RUET rules for audience ALL, expanded far enough for a 4-year projection.
// 2027+ Hijri days are tentative, 2027+ MANUAL_YEARLY days are unknown (nothing shown).
const rules: RuleDef[] = SEED_RULES.map((r, i) => ({
  id: i + 1,
  title: r.title,
  category: 'HOLIDAY',
  classesOnly: !!r.classesOnly,
  audience: [{ scopeType: 'ALL', scopeId: null }],
  params: r.params,
  effectiveFromYear: 2026,
  effectiveToYear: null,
}));
const overrides: RuleOverride[] = SEED_RULES.flatMap((r, i) =>
  r.y2026
    ? [
        {
          ruleId: i + 1,
          year: 2026,
          ...r.y2026,
          skipped: false,
          confirmed: r.params.kind === 'HIJRI',
          note: null,
        },
      ]
    : [],
);
const occurrences = expandRules(rules, overrides, { from: '2025-12-01', to: '2031-12-31' }, 1);
const titlesOn = (d: string) =>
  occurrences.filter((o) => o.startDate <= d && d <= o.endDate).map((o) => o.title);
const real: Partial<JourneyInput> = { isOffDay: (d) => titlesOn(d).length > 0, titlesOn };

describe('weekStartOf / labels / slots', () => {
  test.each([
    ['2026-10-03', '2026-10-03'], // Saturday
    ['2026-10-06', '2026-10-03'], // Tuesday
    ['2026-10-09', '2026-10-03'], // Friday: still that week
    ['2026-10-10', '2026-10-10'],
  ])('%s -> %s', (d, want) => expect(weekStartOf(d)).toBe(want));

  test.each([
    [1, '1-1'],
    [2, '1-2'],
    [4, '2-2'],
    [8, '4-2'],
  ])('semester %i -> %s', (n, want) => expect(semesterLabel(n)).toBe(want));

  test('one semester is 20 weeks; CLASS counts 1..13 across the mid break', () => {
    const slots = buildSlots(DEFAULT_STRUCTURE);
    expect(slots).toHaveLength(20);
    expect(slots.filter((s) => s.phase === 'CLASS').map((s) => s.weekNo)).toEqual(
      Array.from({ length: 13 }, (_, i) => i + 1),
    );
    expect(slots.filter((s) => s.phase === 'EXAM').map((s) => s.weekNo)).toEqual([1, 2, 3, 4]);
  });
});

describe('the CSE-23 example (real 2026 rules)', () => {
  // "2-2 exam, week 2 on 24 Oct 2026". Entered on a Wednesday: normalised to Sat 24 Oct.
  const j = run([pos('2026-10-28', 4, 'EXAM', 2)], real);

  test('back-fill: 17 Oct is a full off week, so the exam started 10 Oct', () => {
    expect(at(j, '2026-10-10')).toMatchObject({
      phase: 'EXAM',
      weekNo: 1,
      status: 'COUNTED',
      estimated: true,
    });
    expect(at(j, '2026-10-17')).toMatchObject({
      status: 'SKIPPED',
      skipReasons: [expect.objectContaining({ title: 'Sanatani Holiday' })],
    });
    expect(j.semesters[0]).toMatchObject({ semesterNo: 4, examStart: '2026-10-10' });
  });

  test('earlier phases of 2-2 are estimated, the anchor is not', () => {
    expect(at(j, '2026-10-10')!.estimated).toBe(true);
    expect(at(j, '2026-10-24')!.estimated).toBe(false);
    expect(j.semesters[0]!.startEstimated).toBe(true);
  });

  test('exam weeks, break, then 3-1 class week 1 on 21 Nov', () => {
    expect(at(j, '2026-10-24')).toMatchObject({ phase: 'EXAM', weekNo: 2, semesterNo: 4 });
    expect(at(j, '2026-10-31')).toMatchObject({ phase: 'EXAM', weekNo: 3 });
    expect(at(j, '2026-11-07')).toMatchObject({ phase: 'EXAM', weekNo: 4 });
    expect(at(j, '2026-11-14')).toMatchObject({ phase: 'SEMESTER_BREAK', semesterNo: 4 });
    expect(at(j, '2026-11-21')).toMatchObject({ phase: 'CLASS', weekNo: 1, semesterNo: 5 });
    expect(j.semesters[1]).toMatchObject({
      semesterNo: 5,
      label: '3-1',
      classStart: '2026-11-21',
      confirmed: false,
    });
  });

  test('winter break: both 19 Dec and 26 Dec weeks are skipped; 14+16 Dec do not shift', () => {
    expect(skipped(j).filter((d) => d >= '2026-11-21' && d <= '2027-01-30')).toEqual([
      '2026-12-19',
      '2026-12-26',
    ]);
    expect(at(j, '2026-12-12')).toMatchObject({ status: 'COUNTED', phase: 'CLASS', weekNo: 4 });
    expect(at(j, '2027-01-02')).toMatchObject({ status: 'COUNTED', phase: 'CLASS', weekNo: 5 });
  });

  test('state on 28 Oct: exam week 2, next milestone is the 2-2 break, delays are grouped', () => {
    const s = stateOn(j, '2026-10-28');
    expect(s).toMatchObject({
      status: 'RUNNING',
      semesterNo: 4,
      semesterLabel: '2-2',
      phase: 'EXAM',
      weekNo: 2,
      confirmed: true,
      onSkippedWeek: false,
    });
    expect(s.nextMilestone).toMatchObject({
      phase: 'SEMESTER_BREAK',
      date: '2026-11-14',
      semesterNo: 4,
    });
    // 3-1 CLASS week 1 is 21 Nov (spec §4): the headline's "3-1 starts around 21 Nov".
    expect(s.nextSemester).toEqual({ semesterNo: 5, date: '2026-11-21', confirmed: false });
    // Only this semester up to today: the Oct holiday, never the winter vacation months away.
    expect(s.delayReasons).toEqual([
      { reason: 'Sanatani Holiday', weeks: 1, start: '2026-10-17', end: '2026-10-21' },
    ]);
    expect(s.delayWeeks).toBe(s.delayReasons.reduce((n, r) => n + r.weeks, 0));
  });

  test('state before / after the journey', () => {
    expect(stateOn(j, '2025-01-01').status).toBe('BEFORE');
    expect(stateOn(j, j.graduation!).status).toBe('GRADUATED');
    expect(stateOn(run([]), '2026-10-28').status).toBe('NONE');
  });
});

describe('skip rules', () => {
  test('14 Dec + 16 Dec alone: no skip', () => {
    const j = run(
      [start('2026-11-21', 5)],
      offOf(['2026-12-14', '2026-12-14'], ['2026-12-16', '2026-12-16']),
    );
    expect(skipped(j)).toEqual([]);
  });

  test('a holiday split across two weeks never shifts anything', () => {
    // Mon..Wed of one week and Sat..Mon of the next: each week still has working days left.
    const j = run(
      [start('2026-10-03')],
      offOf(['2026-10-12', '2026-10-14'], ['2026-10-17', '2026-10-19']),
    );
    expect(skipped(j)).toEqual([]);
  });

  test('a full off week in an extendable phase is skipped and everything moves one week', () => {
    const plain = run([start('2026-10-03')]);
    const j = run([start('2026-10-03')], offOf(['2026-10-10', '2026-10-14']));
    expect(skipped(j)).toEqual(['2026-10-10']);
    expect(j.graduation).toBe(addDays(plain.graduation!, 7));
  });

  test('Thursday/Friday are not working days: Sat-Wed all off is a full week', () => {
    const j = run([start('2026-10-03')], offOf(['2026-10-10', '2026-10-16']));
    expect(skipped(j)).toEqual(['2026-10-10']);
  });

  test('full off week in MID_BREAK and in SEMESTER_BREAK: no skip', () => {
    // Start Sat 3 Oct: classes 3 Oct-14 Nov, MID_BREAK 21 Nov, ..., SEMESTER_BREAK 13 Feb 2027.
    const j = run(
      [start('2026-10-03')],
      offOf(['2026-11-21', '2026-11-25'], ['2027-02-13', '2027-02-17']),
    );
    expect(skipped(j)).toEqual([]);
    expect(at(j, '2026-11-21')).toMatchObject({ phase: 'MID_BREAK', status: 'COUNTED' });
    expect(at(j, '2027-02-13')).toMatchObject({ phase: 'SEMESTER_BREAK', status: 'COUNTED' });
    expect(j.semesters[1]!.classStart).toBe('2027-02-20');
  });

  test('suspended week for EEE-23 only: EEE-23 shifts, CSE-23 does not', () => {
    const p = [pos('2026-10-24', 4, 'EXAM', 2)];
    const cse = run(p);
    const eee = run(p, offOf(['2026-11-07', '2026-11-11'])); // Sat-Wed in exam week 4
    expect(skipped(cse)).toEqual([]);
    expect(skipped(eee)).toEqual(['2026-11-07']);
    expect(at(cse, '2026-11-21')).toMatchObject({ semesterNo: 5, phase: 'CLASS', weekNo: 1 });
    expect(at(eee, '2026-11-28')).toMatchObject({ semesterNo: 5, phase: 'CLASS', weekNo: 1 });
    expect(eee.graduation).toBe(addDays(cse.graduation!, 7));
  });
});

describe('admin data wins', () => {
  test('a later POSITION overrides the computation', () => {
    const j = run([start('2026-10-03'), pos('2026-11-28', 1, 'CLASS', 10)]);
    expect(at(j, '2026-11-21')).toMatchObject({ phase: 'MID_BREAK' }); // computed
    expect(at(j, '2026-11-28')).toMatchObject({ phase: 'CLASS', weekNo: 10, confirmed: true });
    expect(at(j, '2026-12-05')).toMatchObject({ phase: 'CLASS', weekNo: 11 });
  });

  test('a position on a fully off week still counts', () => {
    const j = run([pos('2026-10-10', 1, 'CLASS', 3)], offOf(['2026-10-10', '2026-10-14']));
    expect(at(j, '2026-10-10')).toMatchObject({ status: 'COUNTED', phase: 'CLASS', weekNo: 3 });
  });

  test('SEMESTER_START on a Tuesday: that week is CLASS week 1', () => {
    const j = run([start('2026-10-06', 3)]);
    expect(j.weeks[0]).toMatchObject({
      weekStart: '2026-10-03',
      semesterNo: 3,
      phase: 'CLASS',
      weekNo: 1,
    });
    expect(j.semesters[0]).toMatchObject({
      classStart: '2026-10-03',
      confirmed: true,
      startEstimated: false,
    });
  });

  test('SEMESTER_START for the next semester pins its first class week', () => {
    const j = run([pos('2026-10-24', 4, 'EXAM', 2), start('2026-12-05', 5)]);
    expect(at(j, '2026-12-05')).toMatchObject({
      semesterNo: 5,
      phase: 'CLASS',
      weekNo: 1,
      confirmed: true,
    });
    expect(j.semesters.find((s) => s.semesterNo === 5)).toMatchObject({
      classStart: '2026-12-05',
      confirmed: true,
    });
    // the walk does not run ahead of the confirmed start date
    expect(
      j.weeks.filter(
        (w) => w.semesterNo === 5 && w.weekStart < '2026-12-05' && w.status === 'COUNTED',
      ),
    ).toEqual([]);
  });

  test('a position the structure cannot place is ignored', () => {
    expect(run([pos('2026-10-24', 4, 'EXAM', 9)]).weeks).toEqual([]);
  });
});

describe('the whole programme', () => {
  test('1-1 has the same structure; 8 semesters, then graduation after 4-2 exams', () => {
    const j = run([start('2026-10-03')]);
    expect(j.semesters.map((s) => s.semesterNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(j.semesters[0]).toMatchObject({
      label: '1-1',
      classStart: '2026-10-03',
      midBreakStart: '2026-11-21',
      vivaStart: '2027-01-09',
      examStart: '2027-01-16',
      breakStart: '2027-02-13',
      end: '2027-02-19',
    });
    expect(j.semesters[1]!.classStart).toBe('2027-02-20');
    // 7 semesters of 20 weeks + 19 weeks for 4-2 (no break after it) = 159 weeks
    expect(j.weeks).toHaveLength(159);
    const last = j.weeks[158]!;
    expect(last).toMatchObject({ semesterNo: 8, phase: 'EXAM', weekNo: 4 });
    expect(j.graduation).toBe(addDays(last.weekStart, 7));
    expect(j.semesters[7]!.breakStart).toBeNull();
    expect(j.semesters[7]!.end).toBe(addDays(last.weekStart, 6));
    expect(stateOn(j, j.graduation!).status).toBe('GRADUATED');
  });

  test('until cuts the walk short: no graduation, last semester has no end', () => {
    const j = run([start('2026-10-03')], { until: '2026-12-31' });
    expect(j.graduation).toBeNull();
    expect(j.weeks.at(-1)!.weekStart <= '2026-12-31').toBe(true);
    expect(j.semesters[0]!.end).toBeNull();
  });

  test('Ramadan 2027 (tentative Hijri) shifts the projected semesters', () => {
    const p = [pos('2026-10-24', 4, 'EXAM', 2)];
    const withRamadan = run(p, real);
    const without = run(p, offOf());
    const ramadan = withRamadan.weeks.filter(
      (w) => w.status === 'SKIPPED' && w.weekStart >= '2027-01-30' && w.weekStart <= '2027-04-30',
    );
    expect(ramadan.length).toBeGreaterThanOrEqual(3);
    expect(ramadan.some((w) => w.skipReasons.some((r) => r.title === 'Ramadan Vacation'))).toBe(
      true,
    );
    expect(ramadan.every((w) => !w.confirmed)).toBe(true); // projected, not confirmed
    expect(withRamadan.graduation! > without.graduation!).toBe(true);
  });

  test('confirmed covers the anchor semester only; later semesters are projected', () => {
    const j = run([pos('2026-10-24', 4, 'EXAM', 2)], real);
    expect(j.weeks.filter((w) => w.confirmed).every((w) => w.semesterNo === 4)).toBe(true);
    expect(at(j, '2026-10-24')!.confirmed).toBe(true);
    expect(at(j, '2026-10-10')!.confirmed).toBe(false); // back-filled
    expect(j.semesters.map((s) => s.confirmed)).toEqual([true, false, false, false, false]);
  });
});

describe('delayReasons', () => {
  const j = run([start('2026-10-03', 4)], {
    isOffDay: (d) => d >= '2026-10-10' && d <= '2026-10-28',
    // A covers Sat-Sun-Mon of the first week (3 working days), B the rest; B covers most of week 2.
    titlesOn: (d) => (d <= '2026-10-12' ? ['A'] : ['B']),
  });

  test('one line per holiday, named by the holiday that covers most of each week', () => {
    const r = delayReasons(j, 4, '2026-12-31');
    expect(r.map((x) => [x.reason, x.weeks])).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
  });

  test('only weeks that have started by the selected date', () => {
    expect(delayReasons(j, 4, '2026-10-09')).toEqual([]);
    expect(delayReasons(j, 4, '2026-10-10').map((x) => x.reason)).toEqual(['A']);
  });

  test('only the given semester', () => {
    expect(delayReasons(j, 5, '2030-01-01')).toEqual([]);
  });
});

describe('impact diff', () => {
  test('adding a full off week moves later blocks and graduation by a week', () => {
    const p = [pos('2026-10-24', 4, 'EXAM', 2)];
    const before = run(p);
    const after = run(p, offOf(['2026-11-07', '2026-11-11']));
    const d = diffJourneys(before, after, 4)!;
    expect(d.endShiftWeeks).toBe(1);
    expect(d.changes.find((c) => c.semesterNo === 5 && c.phase === 'CLASS')).toMatchObject({
      before: '2026-11-21',
      after: '2026-11-28',
    });
    expect(diffJourneys(before, run(p), 4)).toBeNull();
  });
});

describe('phase length comes from the structure', () => {
  test.each([
    [4, DEFAULT_STRUCTURE],
    [5, DEFAULT_STRUCTURE.map((b) => (b.phase === 'EXAM' ? { ...b, weeks: 5 } : b))],
  ])('exam of %i weeks', (weeks, structure) => {
    const j = run([pos('2026-10-24', 4, 'EXAM', 2)], { structure });
    expect(stateOn(j, '2026-10-24')).toMatchObject({ phase: 'EXAM', weekNo: 2, phaseWeeks: weeks });
  });
});
