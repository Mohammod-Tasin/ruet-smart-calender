import { describe, expect, test } from 'vitest';
import { addDays } from '@/core/calendar/hijri';
import { expandRules, type RuleDef, type RuleOverride } from '@/core/calendar/rules';
import { SEED_RULES } from '@/core/calendar/seed-rules';
import { milestones } from '@/core/semester/impact';
import {
  computeTimeline,
  DEFAULT_TEMPLATE,
  stateOn,
  weekStartOf,
  type Template,
  type TimelineInput,
} from '@/core/semester/timeline';

/** A holiday lookup from [start, end] ranges (inclusive). */
const offOf = (...ranges: [string, string][]) => {
  const has = (d: string) => ranges.some(([s, e]) => s <= d && d <= e);
  return { isOffDay: has, titlesOn: (d: string) => (has(d) ? ['Holiday'] : []) };
};
const run = (over: Partial<TimelineInput> = {}) =>
  computeTimeline({ startDate: '2026-10-03', template: DEFAULT_TEMPLATE, ...offOf(), ...over });

const starts = (tl: ReturnType<typeof run>) =>
  Object.fromEntries(milestones(tl).map((m) => [m.segment, m.date]));
const skipped = (tl: ReturnType<typeof run>) =>
  tl.weeks.filter((w) => w.status !== 'COUNTED').map((w) => w.weekStart);
const classWeek = (tl: ReturnType<typeof run>, n: number) =>
  tl.weeks.find((w) => w.classWeekNo === n)?.weekStart;

describe('weekStartOf', () => {
  test.each([
    ['2026-10-03', '2026-10-03'], // Saturday
    ['2026-10-04', '2026-10-03'], // Sunday
    ['2026-10-09', '2026-10-03'], // Friday: still that week
    ['2026-10-10', '2026-10-10'],
  ])('%s -> %s', (d, want) => expect(weekStartOf(d)).toBe(want));
});

describe('computeTimeline: the worked example (start Sat 3 Oct 2026)', () => {
  test('no holidays', () => {
    const tl = run();
    expect(classWeek(tl, 1)).toBe('2026-10-03');
    expect(classWeek(tl, 7)).toBe('2026-11-14');
    expect(starts(tl)).toEqual({
      0: '2026-10-03',
      1: '2026-11-21', // mid break
      2: '2026-11-28', // class week 8
      3: '2027-01-09', // viva
      4: '2027-01-16', // finals
    });
    expect(classWeek(tl, 13)).toBe('2027-01-02');
    expect(tl.endDate).toBe('2027-02-12');
    expect(tl.completed).toBe(true);
    expect(tl.weeks).toHaveLength(19);
    expect(skipped(tl)).toEqual([]);
  });

  test('a whole-university week off (Sat 17 - Wed 21 Oct) shifts everything after it', () => {
    const tl = run(offOf(['2026-10-17', '2026-10-21']));
    expect(skipped(tl)).toEqual(['2026-10-17']);
    expect(tl.weeks.find((w) => w.weekStart === '2026-10-17')).toMatchObject({
      status: 'HOLIDAY_SKIPPED',
      phaseWeekIndex: null,
      reason: 'Holiday',
    });
    expect(starts(tl)).toMatchObject({ 1: '2026-11-28', 4: '2027-01-23' });
    expect(tl.endDate).toBe('2027-02-19');
  });

  test('the same week off for EEE only: EEE shifts, CSE does not', () => {
    const eee = run(offOf(['2026-10-17', '2026-10-21']));
    const cse = run(offOf());
    expect(starts(eee)[4]).toBe('2027-01-23');
    expect(starts(cse)[4]).toBe('2027-01-16');
  });
});

describe('computeTimeline: which weeks shift', () => {
  const base = starts(run());

  test.each<[string, [string, string][]]>([
    [
      'two scattered days',
      [
        ['2026-10-17', '2026-10-17'],
        ['2026-10-19', '2026-10-19'],
      ],
    ],
    ['a holiday split over two weeks (Mon to next Sun)', [['2026-10-19', '2026-10-25']]],
    ['Thu/Fri only (weekly off, not a holiday)', [['2026-10-22', '2026-10-23']]],
    ['four of the five working days', [['2026-10-17', '2026-10-20']]],
  ])('%s: no shift', (_name, ranges) => {
    const tl = run(offOf(...ranges));
    expect(skipped(tl)).toEqual([]);
    expect(starts(tl)).toEqual(base);
  });

  test('a full week inside MID_BREAK does not shift anything', () => {
    const tl = run(offOf(['2026-11-21', '2026-11-25']));
    expect(skipped(tl)).toEqual([]);
    expect(starts(tl)).toEqual(base);
    expect(tl.weeks.find((w) => w.weekStart === '2026-11-21')).toMatchObject({
      phase: 'MID_BREAK',
      status: 'COUNTED',
    });
  });

  test('a full week in VIVA shifts the finals', () => {
    const tl = run(offOf(['2027-01-09', '2027-01-13']));
    expect(skipped(tl)).toEqual(['2027-01-09']);
    expect(starts(tl)).toMatchObject({ 3: '2027-01-16', 4: '2027-01-23' });
  });

  test('a full week in FINALS pushes the end back', () => {
    const tl = run(offOf(['2027-01-16', '2027-01-20']));
    expect(skipped(tl)).toEqual(['2027-01-16']);
    expect(starts(tl)[4]).toBe('2027-01-23');
    expect(tl.endDate).toBe('2027-02-19');
  });

  test('a multi-week vacation (Ramadan-like, 5 weeks) shifts by 5 weeks', () => {
    const tl = run(offOf(['2026-10-17', '2026-11-18']));
    expect(skipped(tl)).toEqual([
      '2026-10-17',
      '2026-10-24',
      '2026-10-31',
      '2026-11-07',
      '2026-11-14',
    ]);
    expect(starts(tl)[4]).toBe(addDays('2027-01-16', 35));
  });

  test('holiday weeks before the start date are ignored', () => {
    const tl = run(offOf(['2026-09-19', '2026-09-23']));
    expect(starts(tl)).toEqual(base);
  });
});

describe('computeTimeline: admin corrections', () => {
  test('checkpoint: "class week 9 from 7 Nov" re-syncs the rest', () => {
    const tl = run({ checkpoints: [{ asOfDate: '2026-11-07', phase: 'CLASS', weekIndex: 9 }] });
    expect(classWeek(tl, 9)).toBe('2026-11-07');
    expect(classWeek(tl, 13)).toBe('2026-12-05');
    expect(starts(tl)).toMatchObject({ 3: '2026-12-12', 4: '2026-12-19' });
    expect(tl.completed).toBe(true);
  });

  test('go-live: start date and checkpoint on the same day', () => {
    const tl = run({
      startDate: '2026-11-04', // a Wednesday: its week starts Sat 31 Oct
      checkpoints: [{ asOfDate: '2026-11-04', phase: 'CLASS', weekIndex: 9 }],
    });
    expect(tl.startDate).toBe('2026-10-31');
    expect(tl.weeks[0]).toMatchObject({ weekStart: '2026-10-31', classWeekNo: 9 });
  });

  test('a checkpoint in another phase', () => {
    const tl = run({ checkpoints: [{ asOfDate: '2026-12-05', phase: 'FINALS', weekIndex: 2 }] });
    const w = tl.weeks.find((x) => x.weekStart === '2026-12-05')!;
    expect(w).toMatchObject({ phase: 'FINALS', phaseWeekIndex: 2 });
    expect(tl.endDate).toBe('2026-12-25');
  });

  test('the latest checkpoint at or before a week wins', () => {
    const tl = run({
      checkpoints: [
        { asOfDate: '2026-11-07', phase: 'CLASS', weekIndex: 9 },
        { asOfDate: '2026-11-14', phase: 'CLASS', weekIndex: 3 },
      ],
    });
    // class week 3 happens twice: once before the second checkpoint, once from it
    expect(tl.weeks.filter((w) => w.classWeekNo === 3).map((w) => w.weekStart)).toEqual([
      '2026-10-17',
      '2026-11-14',
    ]);
    expect(classWeek(tl, 9)).toBe('2026-11-07');
  });

  test('FORCE_EXTEND skips a week that is not fully off', () => {
    const tl = run({ weekOverrides: [{ weekStart: '2026-10-24', mode: 'FORCE_EXTEND' }] });
    expect(tl.weeks.find((w) => w.weekStart === '2026-10-24')).toMatchObject({
      status: 'FORCED_SKIP',
      reason: 'Extended by admin',
    });
    expect(starts(tl)[1]).toBe('2026-11-28');
  });

  test('FORCE_EXTEND does nothing in the non-extendable MID_BREAK', () => {
    const tl = run({ weekOverrides: [{ weekStart: '2026-11-21', mode: 'FORCE_EXTEND' }] });
    expect(skipped(tl)).toEqual([]);
  });

  test('NO_EXTEND counts a fully-off week (e.g. online classes)', () => {
    const tl = run({
      ...offOf(['2026-10-17', '2026-10-21']),
      weekOverrides: [{ weekStart: '2026-10-17', mode: 'NO_EXTEND' }],
    });
    expect(skipped(tl)).toEqual([]);
    expect(starts(tl)[4]).toBe('2027-01-16');
  });

  test('a week override date may be any day of the week', () => {
    const tl = run({ weekOverrides: [{ weekStart: '2026-10-28', mode: 'FORCE_EXTEND' }] });
    expect(skipped(tl)).toEqual(['2026-10-24']);
  });

  test('template override: 2 class weeks, 2 break weeks, 1 finals week', () => {
    const template: Template = [
      { phase: 'CLASS', weeks: 2, extendable: true },
      { phase: 'MID_BREAK', weeks: 2, extendable: false },
      { phase: 'FINALS', weeks: 1, extendable: true },
    ];
    const tl = run({ template });
    expect(tl.weeks.map((w) => [w.weekStart, w.phase])).toEqual([
      ['2026-10-03', 'CLASS'],
      ['2026-10-10', 'CLASS'],
      ['2026-10-17', 'MID_BREAK'],
      ['2026-10-24', 'MID_BREAK'],
      ['2026-10-31', 'FINALS'],
    ]);
    expect(tl.totalClassWeeks).toBe(2);
    expect(tl.endDate).toBe('2026-11-06');
  });

  test('pin later than computed: the phase waits, held weeks do not count', () => {
    const tl = run({ pins: [{ phase: 'FINALS', startDate: '2027-02-06' }] });
    expect(starts(tl)[4]).toBe('2027-02-06');
    expect(skipped(tl)).toEqual(['2027-01-16', '2027-01-23', '2027-01-30']);
    expect(tl.endDate).toBe('2027-03-05');
  });

  test('pin earlier than computed: the phase starts on the pin and the rest follows', () => {
    const tl = run({ pins: [{ phase: 'FINALS', startDate: '2027-01-09' }] });
    expect(starts(tl)[4]).toBe('2027-01-09');
    expect(starts(tl)[3]).toBeUndefined(); // viva was jumped over
    expect(tl.endDate).toBe('2027-02-05');
  });

  test('computation continues from a pin (holiday after it still shifts)', () => {
    const tl = run({
      pins: [{ phase: 'FINALS', startDate: '2027-02-06' }],
      ...offOf(['2027-02-13', '2027-02-17']),
    });
    expect(tl.endDate).toBe('2027-03-12');
  });
});

describe('stateOn', () => {
  const tl = run(offOf(['2026-10-17', '2026-10-21'])); // one skipped week
  const at = (d: string) => stateOn(tl, DEFAULT_TEMPLATE, d);

  test('before the start', () => {
    expect(at('2026-09-01')).toMatchObject({
      phase: 'NOT_STARTED',
      nextMilestone: { phase: 'CLASS', date: '2026-10-03' },
    });
  });

  test('inside a class week, with the next milestone and delay', () => {
    const s = at('2026-11-03'); // week of 31 Oct: week 5 normally, 4 after the skipped week
    expect(s).toMatchObject({
      phase: 'CLASS',
      label: 'Class week 4/13',
      classWeekNo: 4,
      totalClassWeeks: 13,
      delayedWeeks: 1,
      reasons: [{ reason: 'Holiday', weeks: 1 }],
      onSkippedWeek: false,
      nextMilestone: { phase: 'MID_BREAK', date: '2026-11-28' },
    });
    expect(s.progress).toBeCloseTo(4 / 19);
  });

  test('on the skipped week itself', () => {
    expect(at('2026-10-19')).toMatchObject({
      phase: 'CLASS',
      label: 'Class: holiday week',
      onSkippedWeek: true,
    });
  });

  test('mid break, viva, finals', () => {
    expect(at('2026-11-30').label).toBe('Mid break');
    expect(at('2026-11-30').nextMilestone).toEqual({ phase: 'CLASS', date: '2026-12-05' });
    expect(at('2027-01-18')).toMatchObject({ phase: 'VIVA', label: 'Viva' });
    expect(at('2027-01-27')).toMatchObject({ phase: 'FINALS', label: 'Finals week 1/4' });
  });

  test('the last day and after the end', () => {
    expect(at('2027-02-19')).toMatchObject({
      phase: 'FINALS',
      nextMilestone: { phase: 'ENDED', date: '2027-02-20' },
    });
    expect(at('2027-02-20')).toMatchObject({
      phase: 'AWAITING_NEXT',
      label: 'Semester ended: enter the next start date',
      progress: 1,
      nextMilestone: null,
    });
  });

  test('a semester an admin marked COMPLETED has a proper completed state', () => {
    const done = (d: string) => stateOn(tl, DEFAULT_TEMPLATE, d, { completed: true });
    // in the middle of the timeline, after it, and long before/after: always the same state
    for (const d of ['2026-09-01', '2026-11-03', '2027-01-27', '2027-03-01', '2090-01-01']) {
      expect(done(d)).toMatchObject({
        phase: 'COMPLETED',
        label: 'Semester completed',
        classWeekNo: null,
        progress: 1,
        nextMilestone: null,
        onSkippedWeek: false,
        totalClassWeeks: 13,
      });
    }
    expect(done('2026-11-03').delayedWeeks).toBe(1); // the history is still there
  });
});

// Found by test:semesters in 2090, where Eid-ul-Adha falls in the finals period.
describe('interaction of corrections with holidays', () => {
  test('a forced extension can be absorbed when it moves the mid break into a vacation', () => {
    const vacation: [string, string] = ['2026-11-28', '2026-12-02']; // a full week
    const plain = run(offOf(vacation));
    // Without the correction the vacation lands in class week 8 and pushes everything +1 week.
    expect(plain.endDate).toBe('2027-02-19');
    expect(skipped(plain)).toEqual(['2026-11-28']);

    const forced = run({
      ...offOf(vacation),
      weekOverrides: [{ weekStart: '2026-10-24', mode: 'FORCE_EXTEND' }],
    });
    // The forced week is skipped and the mid break moves to 28 Nov, inside the vacation. A full
    // holiday week in the mid break shifts nothing, so the vacation now costs no extra week.
    expect(forced.weeks.find((w) => w.weekStart === '2026-10-24')?.status).toBe('FORCED_SKIP');
    expect(forced.weeks.find((w) => w.weekStart === '2026-11-28')).toMatchObject({
      phase: 'MID_BREAK',
      status: 'COUNTED',
    });
    expect(skipped(forced)).toEqual(['2026-10-24']);
    expect(forced.endDate).toBe(plain.endDate);
    // What the extension does guarantee: the class week that was pushed out comes one week later.
    const classWeek4 = (t: typeof plain) => t.weeks.find((w) => w.classWeekNo === 4)!.weekStart;
    expect(classWeek4(plain)).toBe('2026-10-24');
    expect(classWeek4(forced)).toBe('2026-10-31');
  });

  test('a pin on a week that is fully off still starts the phase on the pin date', () => {
    const eid: [string, string] = ['2027-02-06', '2027-02-10']; // a full week
    const pins = [{ phase: 'FINALS' as const, startDate: '2027-02-06' }];
    const unpinned = run({ ...offOf(eid) });
    // Without a pin the computed finals start 16 Jan (before the vacation) and nothing is pinned.
    expect(starts(unpinned)[4]).toBe('2027-01-16');

    const pinned = run({ ...offOf(eid), pins });
    expect(starts(pinned)[4]).toBe('2027-02-06'); // exactly the date the admin typed
    expect(pinned.weeks.find((w) => w.weekStart === '2027-02-06')).toMatchObject({
      status: 'COUNTED',
      reason: 'Fixed start date, counted although the whole week is off',
    });
    expect(skipped(pinned)).toEqual(['2027-01-16', '2027-01-23', '2027-01-30']); // the waiting weeks
  });

  test('only the pinned week is exempt: a later off week still extends the phase', () => {
    const tl = run({
      ...offOf(['2027-02-06', '2027-02-10'], ['2027-02-13', '2027-02-17']),
      pins: [{ phase: 'FINALS', startDate: '2027-02-06' }],
    });
    expect(skipped(tl)).toContain('2027-02-13');
    expect(tl.weeks.filter((w) => w.phase === 'FINALS' && w.status === 'COUNTED')).toHaveLength(4);
  });
});

describe('2026 sanity checks with the real seeded RUET rules (Sat-Wed weeks)', () => {
  // Rebuild the seeded rules exactly as db:seed stores them: audience ALL, 2026 overrides.
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
  const occurrences = expandRules(rules, overrides, { from: '2025-12-01', to: '2027-03-01' }, 1);
  const titlesOn = (d: string) =>
    occurrences.filter((o) => o.startDate <= d && d <= o.endDate).map((o) => o.title);

  // One long extendable phase starting Sat 3 Jan 2026: every fully-off week shows up as skipped.
  const tl = computeTimeline({
    startDate: '2026-01-03',
    template: [{ phase: 'CLASS', weeks: 70, extendable: true }],
    isOffDay: (d) => titlesOn(d).length > 0,
    titlesOn,
  });
  const skippedIn2026 = tl.weeks
    .filter((w) => w.status === 'HOLIDAY_SKIPPED' && w.weekStart < '2027-01-01')
    .map((w) => w.weekStart);

  test('Ramadan + Eid-ul-Fitr (19 Feb - 25 Mar): 5 full weeks', () => {
    expect(skippedIn2026.filter((d) => d >= '2026-02-01' && d <= '2026-04-30')).toEqual([
      '2026-02-21',
      '2026-02-28',
      '2026-03-07',
      '2026-03-14',
      '2026-03-21',
    ]);
  });

  test('summer + Eid-ul-Adha (21 May - 3 Jun): 2 full weeks', () => {
    expect(skippedIn2026.filter((d) => d >= '2026-05-01' && d <= '2026-06-30')).toEqual([
      '2026-05-23',
      '2026-05-30',
    ]);
  });

  test('সনাতনী ছুটি 17-21 Oct: exactly 1 full week', () => {
    expect(skippedIn2026.filter((d) => d >= '2026-10-01' && d <= '2026-11-30')).toEqual([
      '2026-10-17',
    ]);
  });

  test('winter (19-31 Dec): 2 full weeks', () => {
    expect(skippedIn2026.filter((d) => d >= '2026-12-01')).toEqual(['2026-12-19', '2026-12-26']);
  });

  test('14 Dec + 16 Dec alone: no skip (partial week)', () => {
    const w = tl.weeks.find((x) => x.weekStart === '2026-12-12')!;
    expect(w.status).toBe('COUNTED');
    expect(titlesOn('2026-12-14')).toHaveLength(1);
    expect(titlesOn('2026-12-16')).toHaveLength(1);
  });

  test('those are the only skipped weeks in 2026', () => {
    expect(skippedIn2026).toHaveLength(10);
  });

  test('a semester running through Ramadan reports the delay and its reasons', () => {
    const sem = computeTimeline({
      startDate: '2026-01-03',
      template: DEFAULT_TEMPLATE,
      isOffDay: (d) => titlesOn(d).length > 0,
      titlesOn,
    });
    const state = stateOn(sem, DEFAULT_TEMPLATE, '2026-01-10');
    expect(state.delayedWeeks).toBeGreaterThanOrEqual(5);
    expect(state.reasons.length).toBeGreaterThan(0);
  });
});
