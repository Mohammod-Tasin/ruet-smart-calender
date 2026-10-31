import { describe, expect, test } from 'vitest';
import { addDays, weekdayOf } from '@/core/calendar/hijri';
import {
  needsPastConfirm,
  pastMessage,
  planOccurrenceEdit,
  spanText,
  touchesPast,
  type OccurrenceEditInput,
} from '@/core/calendar/past';
import { computeRuleDates, patternParams } from '@/core/calendar/rules';
import { SEED_RULES } from '@/core/calendar/seed-rules';

const d = (startDate: string, endDate = startDate) => ({ startDate, endDate });
const edit = (over: Partial<OccurrenceEditInput>) =>
  planOccurrenceEdit({
    today: '2026-12-15',
    year: 2026,
    ruleKind: 'GREGORIAN_FIXED',
    original: d('2026-12-16'),
    proposed: d('2026-12-13'),
    scope: 'ONLY_YEAR',
    confirmPast: false,
    ...over,
  });

describe('fixed dates used below', () => {
  test('weekdays are computed, not assumed', () => {
    expect(weekdayOf('2026-12-13')).toBe(0); // Sunday
    expect(weekdayOf('2026-12-16')).toBe(3); // Wednesday
    expect(weekdayOf('2026-12-17')).toBe(4); // Thursday
  });
});

describe('rule 1: the new dates are already gone', () => {
  // Today 15 Dec 2026: Victory Day (16 Dec) is asked to move to 13 Dec.
  const message =
    "13 Dec 2026 has already passed, so this change starts from 2027. This year's holiday stays on 16 Dec.";

  test.each(['ONLY_YEAR', 'FROM_YEAR'] as const)('15 Dec -> 13 Dec is refused for %s', (scope) => {
    expect(edit({ scope })).toEqual({ ok: false, code: 'UNPROCESSABLE', message });
  });

  test('"every year from 2027" is the way out', () => {
    expect(edit({ scope: 'FROM_NEXT_YEAR' })).toMatchObject({
      ok: true,
      pattern: d('2026-12-13'),
      pastEdit: false,
    });
  });

  test('ending yesterday is gone, ending today is not', () => {
    expect(edit({ proposed: d('2026-12-14') }).ok).toBe(false);
    expect(edit({ proposed: d('2026-12-15') })).toMatchObject({ ok: true, clipped: false });
  });

  test('a future move is plain', () => {
    expect(edit({ proposed: d('2026-12-20') })).toMatchObject({
      ok: true,
      dates: d('2026-12-20'),
      clipped: false,
      note: null,
    });
  });
});

describe('rule 2: the original is already over', () => {
  const over = { today: '2026-12-17' }; // 16 Dec ended yesterday

  test('needs the "Fix a past holiday" confirm', () => {
    for (const scope of ['ONLY_YEAR', 'FROM_YEAR'] as const) {
      expect(edit({ ...over, scope })).toMatchObject({ ok: false, code: 'PAST_CONFIRM' });
    }
  });

  test('confirmed: allowed, flagged as a past edit', () => {
    expect(edit({ ...over, confirmPast: true })).toMatchObject({
      ok: true,
      dates: d('2026-12-13'),
      pastEdit: true,
    });
  });

  test('on its last day it is still running, not over', () => {
    expect(edit({ today: '2026-12-16', proposed: d('2026-12-18') })).toMatchObject({
      ok: true,
      pastEdit: false,
    });
  });

  test('"every year from next year" never rewrites this year, so no confirm', () => {
    expect(edit({ ...over, scope: 'FROM_NEXT_YEAR' })).toMatchObject({
      ok: true,
      pastEdit: false,
    });
  });
});

describe('rule 3: started in the past, ends in the future', () => {
  const run = (over: Partial<OccurrenceEditInput>) =>
    edit({ today: '2026-12-12', original: d('2026-12-10', '2026-12-14'), ...over });

  test('only the end moves: nothing to clip', () => {
    expect(run({ proposed: d('2026-12-10', '2026-12-16') })).toMatchObject({
      ok: true,
      dates: d('2026-12-10', '2026-12-16'),
      clipped: false,
    });
  });

  test('past days keep what they were', () => {
    const r = run({ proposed: d('2026-12-11', '2026-12-16') });
    expect(r).toMatchObject({ ok: true, dates: d('2026-12-10', '2026-12-16'), clipped: true });
    expect(r.ok && r.note).toContain('Days before today cannot change');
  });

  test('a start in the past on a holiday that has not started clips to today', () => {
    const r = edit({
      today: '2026-12-15',
      original: d('2026-12-16', '2026-12-18'),
      proposed: d('2026-12-13', '2026-12-18'),
    });
    expect(r).toMatchObject({ ok: true, dates: d('2026-12-15', '2026-12-18'), clipped: true });
  });

  test('moving the start past today would leave a gap: refused', () => {
    expect(run({ proposed: d('2026-12-14', '2026-12-16') })).toMatchObject({
      ok: false,
      code: 'UNPROCESSABLE',
    });
  });

  test('"this year and after" cannot be clipped', () => {
    expect(run({ proposed: d('2026-12-11', '2026-12-16'), scope: 'FROM_YEAR' })).toMatchObject({
      ok: false,
      code: 'UNPROCESSABLE',
    });
  });

  test('FROM_NEXT_YEAR keeps the typed pattern unclipped', () => {
    const r = run({ proposed: d('2026-12-11', '2026-12-16'), scope: 'FROM_NEXT_YEAR' });
    expect(r).toMatchObject({ ok: true, pattern: d('2026-12-11', '2026-12-16'), clipped: false });
  });
});

describe('manual yearly holidays have no pattern', () => {
  test.each(['FROM_YEAR', 'FROM_NEXT_YEAR'] as const)('%s is refused', (scope) => {
    expect(edit({ ruleKind: 'MANUAL_YEARLY', scope, proposed: d('2026-12-20') })).toMatchObject({
      ok: false,
      code: 'UNPROCESSABLE',
    });
  });
  test('this year only is fine', () => {
    expect(edit({ ruleKind: 'MANUAL_YEARLY', proposed: d('2026-12-20') }).ok).toBe(true);
  });
});

describe('one-off holidays: any touch of the past needs the confirm', () => {
  const today = '2026-12-15';
  test.each([
    ['both in the future', [d('2026-12-20')], false],
    ['starts today', [d('2026-12-15', '2026-12-18')], false],
    ['starts yesterday and is still running', [d('2026-12-14', '2026-12-18')], true],
    ['original in the past, new in the future', [d('2026-12-01'), d('2026-12-20')], true],
    ['original in the future, new in the past', [d('2026-12-20'), d('2026-12-10')], true],
    ['create with nothing to compare', [null, d('2026-12-20')], false],
    ['delete a past one', [d('2026-12-01'), null], true],
  ] as const)('%s', (_name, ranges, expected) => {
    expect(needsPastConfirm(today, [...ranges])).toBe(expected);
  });

  test('touchesPast is "starts before today"', () => {
    expect(touchesPast(d('2026-12-14', '2026-12-30'), today)).toBe(true);
    expect(touchesPast(d('2026-12-15'), today)).toBe(false);
  });

  test('message names how many series are recalculated', () => {
    expect(pastMessage(3)).toBe(
      'This holiday is in the past. Changing it recalculates the semester history of 3 series.',
    );
    expect(pastMessage(0)).toContain('does not move any series');
  });
});

describe('spanText', () => {
  test.each([
    [d('2026-12-16'), false, '16 Dec'],
    [d('2026-12-13'), true, '13 Dec 2026'],
    [d('2026-10-17', '2026-10-21'), false, '17–21 Oct'],
    [d('2026-11-30', '2026-12-02'), true, '30 Nov – 2 Dec 2026'],
  ])('%j', (r, year, expected) => {
    expect(spanText(r, year)).toBe(expected);
  });
});

describe('patternParams: "this year and every year after"', () => {
  test('fixed date: new day, month and length', () => {
    const p = SEED_RULES.find((r) => r.title === 'Victory Day')!.params;
    expect(patternParams(p, d('2026-12-16'), d('2026-12-13'))).toEqual({
      ok: true,
      params: { kind: 'GREGORIAN_FIXED', month: 12, day: 13, lengthDays: 1 },
    });
    expect(patternParams(p, d('2026-12-16'), d('2026-12-13', '2026-12-15'))).toMatchObject({
      params: { lengthDays: 3 },
    });
  });

  test('Hijri: the shift follows the moon in every later year', () => {
    const params = SEED_RULES.find((r) => r.title === 'Eid-ul-Adha')!.params;
    const computed = computeRuleDates(params, 2026, 1)!;
    const pattern = d(addDays(computed.startDate, 2), addDays(computed.endDate, 2));
    const res = patternParams(params, computed, pattern);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(computeRuleDates(res.params, 2026, 1)).toEqual(pattern);
    const old27 = computeRuleDates(params, 2027, 1)!;
    expect(computeRuleDates(res.params, 2027, 1)).toEqual(
      d(addDays(old27.startDate, 2), addDays(old27.endDate, 2)),
    );
  });

  test('Hijri: a longer holiday moves only the end offset', () => {
    const params = SEED_RULES.find((r) => r.title === 'Eid-ul-Adha')!.params;
    const computed = computeRuleDates(params, 2026, 1)!;
    const longer = { ...computed, endDate: addDays(computed.endDate, 1) };
    const res = patternParams(params, computed, longer);
    expect(res.ok && computeRuleDates(res.params, 2026, 1)).toEqual(longer);
  });

  test('last-weekday rules and manual rules have no pattern to shift', () => {
    const last = SEED_RULES.find((r) => 'type' in r.params)!.params;
    expect(patternParams(last, d('2026-03-13'), d('2026-03-14')).ok).toBe(false);
    const manual = { kind: 'MANUAL_YEARLY', defaultLengthDays: 1 } as const;
    expect(patternParams(manual, null, d('2026-03-14')).ok).toBe(false);
  });
});
