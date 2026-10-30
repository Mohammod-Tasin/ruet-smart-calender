import { describe, expect, test } from 'vitest';
import { hintedTitle, ruleMonthHints } from '@/core/calendar/rule-hint';
import {
  computeRuleDates,
  expandRules,
  missingManualDates,
  planEdit,
  planEnd,
  resolveRuleYear,
  type RuleDef,
  type RuleOverride,
} from '@/core/calendar/rules';
import { SEED_RULES } from '@/core/calendar/seed-rules';

const ALL = [{ scopeType: 'ALL' as const, scopeId: null }];
const rule = (id: number, params: RuleDef['params'], over: Partial<RuleDef> = {}): RuleDef => ({
  id,
  title: `rule ${id}`,
  category: 'HOLIDAY',
  classesOnly: false,
  audience: ALL,
  params,
  effectiveFromYear: 2026,
  effectiveToYear: null,
  ...over,
});
const ov = (ruleId: number, year: number, o: Partial<RuleOverride> = {}): RuleOverride => ({
  ruleId,
  year,
  startDate: null,
  endDate: null,
  skipped: false,
  confirmed: false,
  note: null,
  ...o,
});

describe('GREGORIAN_FIXED', () => {
  test.each([
    [{ month: 2, day: 21, lengthDays: 1 }, 2027, '2027-02-21', '2027-02-21'],
    [{ month: 12, day: 19, lengthDays: 13 }, 2026, '2026-12-19', '2026-12-31'],
    [{ month: 12, day: 30, lengthDays: 5 }, 2026, '2026-12-30', '2027-01-03'], // spills into next year
    [{ month: 2, day: 28, lengthDays: 2 }, 2028, '2028-02-28', '2028-02-29'], // leap year
  ])('%j in %i', (p, year, start, end) => {
    expect(computeRuleDates({ kind: 'GREGORIAN_FIXED', ...p }, year, 1)).toEqual({
      startDate: start,
      endDate: end,
    });
  });
});

describe('HIJRI', () => {
  // The seed rules, computed with the default BD offset (+1), must reproduce the official
  // 2026 list. Any rule that does not is covered by its confirmed 2026 override instead.
  test.each(SEED_RULES.filter((r) => r.params.kind === 'HIJRI'))(
    '$title reproduces the official 2026 date',
    (r) => {
      expect(computeRuleDates(r.params, 2026, 1)).toEqual(r.y2026);
    },
  );

  test('the BD offset moves every date', () => {
    const p = SEED_RULES.find((r) => r.title === 'Shab-e-Meraj')!.params;
    expect(computeRuleDates(p, 2026, 0)!.startDate).toBe('2026-01-16');
    expect(computeRuleDates(p, 2026, 1)!.startDate).toBe('2026-01-17');
    expect(computeRuleDates(p, 2026, 2)!.startDate).toBe('2026-01-18');
  });

  test('a rule offset adds to the BD offset', () => {
    const point = (offsetDays: number) => ({ month: 7, day: 27, offsetDays });
    const p = { kind: 'HIJRI' as const, startHijri: point(3), endHijri: point(3) };
    expect(computeRuleDates(p, 2026, 1)!.startDate).toBe('2026-01-20');
  });

  test('27 Rajab 1448 lands in Jan 2027, about 11 days before 2026', () => {
    const p = SEED_RULES.find((r) => r.title === 'Shab-e-Meraj')!.params;
    expect(computeRuleDates(p, 2027, 1)!.startDate).toBe('2027-01-06');
  });

  test('tentative until confirmed', () => {
    const r = rule(1, SEED_RULES.find((x) => x.title === 'Shab-e-Barat')!.params);
    expect(resolveRuleYear(r, 2027, undefined, 1).final!.tentative).toBe(true);
    const confirmed = resolveRuleYear(r, 2027, ov(1, 2027, { confirmed: true }), 1);
    expect(confirmed.final!.tentative).toBe(false);
    expect(confirmed.final!.startDate).toBe(confirmed.computed!.startDate); // dates unchanged
  });

  test('an override moves the dates and skip hides the year', () => {
    const r = rule(1, SEED_RULES.find((x) => x.title === 'Shab-e-Barat')!.params);
    const moved = resolveRuleYear(
      r,
      2026,
      ov(1, 2026, { startDate: '2026-02-05', endDate: '2026-02-05' }),
      1,
    );
    expect(moved.final).toMatchObject({ startDate: '2026-02-05', tentative: true });
    expect(resolveRuleYear(r, 2026, ov(1, 2026, { skipped: true }), 1).final).toBeNull();
  });
});

describe('MANUAL_YEARLY', () => {
  const r = rule(7, { kind: 'MANUAL_YEARLY', defaultLengthDays: 1 });

  test('shows nothing without an override', () => {
    expect(expandRules([r], [], { from: '2026-01-01', to: '2026-12-31' }, 1)).toEqual([]);
  });

  test('shows the override dates, never tentative', () => {
    const o = ov(7, 2026, { startDate: '2026-10-17', endDate: '2026-10-21' });
    const [occ] = expandRules([r], [o], { from: '2026-10-01', to: '2026-10-31' }, 1);
    expect(occ).toMatchObject({
      id: 'rule:7:2026',
      startDate: '2026-10-17',
      endDate: '2026-10-21',
      tentative: false,
    });
  });

  test('missing-date detection', () => {
    const rules = [
      r,
      rule(8, { kind: 'MANUAL_YEARLY', defaultLengthDays: 1 }),
      rule(9, {
        kind: 'GREGORIAN_FIXED',
        month: 1,
        day: 1,
        lengthDays: 1,
      }),
    ];
    const dated = ov(7, 2026, { startDate: '2026-10-17', endDate: '2026-10-17' });
    expect(missingManualDates(rules, [dated], 2026).map((x) => x.id)).toEqual([8]);
    expect(missingManualDates(rules, [dated], 2027).map((x) => x.id)).toEqual([7, 8]);
    expect(missingManualDates(rules, [ov(8, 2026, { skipped: true }), dated], 2026)).toEqual([]);
    // not active yet in 2025
    expect(missingManualDates(rules, [], 2025)).toEqual([]);
  });
});

describe('expandRules', () => {
  test('uses synthetic ids and respects the range', () => {
    const r = rule(3, { kind: 'GREGORIAN_FIXED', month: 2, day: 21, lengthDays: 1 });
    const hit = expandRules([r], [], { from: '2026-02-01', to: '2026-02-28' }, 1);
    expect(hit.map((o) => o.id)).toEqual(['rule:3:2026']);
    expect(expandRules([r], [], { from: '2026-03-01', to: '2026-03-31' }, 1)).toEqual([]);
  });

  test('a December rule that spills into January shows in January', () => {
    const r = rule(4, { kind: 'GREGORIAN_FIXED', month: 12, day: 30, lengthDays: 5 });
    const hit = expandRules([r], [], { from: '2027-01-01', to: '2027-01-31' }, 1);
    expect(hit.map((o) => o.endDate)).toEqual(['2027-01-03']);
  });
});

describe('rule versioning: past years never change', () => {
  test('planEdit', () => {
    expect(planEdit({ effectiveFromYear: 2026 }, 2026)).toEqual({ mode: 'IN_PLACE' });
    expect(planEdit({ effectiveFromYear: 2026 }, 2020)).toEqual({ mode: 'IN_PLACE' });
    expect(planEdit({ effectiveFromYear: 2026 }, 2028)).toEqual({
      mode: 'SPLIT',
      oldEffectiveTo: 2027,
    });
  });

  test('planEnd', () => {
    expect(planEnd({ effectiveFromYear: 2026 }, 2026)).toEqual({ mode: 'SOFT_DELETE' });
    expect(planEnd({ effectiveFromYear: 2026 }, 2029)).toEqual({ mode: 'END', effectiveTo: 2028 });
  });

  test('after a split, earlier years keep the old dates and later years use the new rule', () => {
    const old = rule(1, { kind: 'GREGORIAN_FIXED', month: 3, day: 26, lengthDays: 1 });
    const plan = planEdit(old, 2028);
    if (plan.mode !== 'SPLIT') throw new Error('expected a split');
    const before = { ...old, effectiveToYear: plan.oldEffectiveTo };
    const after = rule(
      2,
      { kind: 'GREGORIAN_FIXED', month: 3, day: 27, lengthDays: 2 },
      { effectiveFromYear: 2028 },
    );
    const range = { from: '2026-01-01', to: '2030-12-31' };
    const dates = expandRules([before, after], [], range, 1).map((o) => [o.year, o.startDate]);
    expect(dates).toEqual([
      [2026, '2026-03-26'],
      [2027, '2027-03-26'],
      [2028, '2028-03-27'],
      [2029, '2029-03-27'],
      [2030, '2030-03-27'],
    ]);
  });

  test('an ended rule disappears from the end year on', () => {
    const r = rule(
      1,
      { kind: 'GREGORIAN_FIXED', month: 5, day: 1, lengthDays: 1 },
      {
        effectiveToYear: 2027,
      },
    );
    const years = expandRules([r], [], { from: '2026-01-01', to: '2030-12-31' }, 1).map(
      (o) => o.year,
    );
    expect(years).toEqual([2026, 2027]);
  });
});

describe('ruleMonthHints', () => {
  const mk = (id: number, title: string, params: RuleDef['params']): RuleDef => ({
    id,
    title,
    category: 'HOLIDAY',
    classesOnly: false,
    params,
    audience: [{ scopeType: 'ALL', scopeId: null }],
    effectiveFromYear: 2026,
    effectiveToYear: null,
  });
  const manual = { kind: 'MANUAL_YEARLY', defaultLengthDays: 1 } as const;
  const ov = (ruleId: number, startDate: string) => ({
    ruleId,
    year: 2026,
    startDate,
    endDate: startDate,
    skipped: false,
    confirmed: false,
    note: null,
  });

  test('only rules sharing a title get a hint, taken from the latest occurrence', () => {
    const rules = [
      mk(1, 'Sanatani Holiday', manual),
      mk(2, 'Sanatani Holiday', manual),
      mk(3, 'Sanatani Holiday', manual),
      mk(4, 'May Day', { kind: 'GREGORIAN_FIXED', month: 5, day: 1, lengthDays: 1 }),
    ];
    const hints = ruleMonthHints(
      rules,
      [ov(1, '2026-01-23'), ov(2, '2026-09-04'), ov(3, '2026-10-17')],
      2026,
      1,
    );
    expect([...hints]).toEqual([
      [1, 'Jan'],
      [2, 'Sep'],
      [3, 'Oct'],
    ]);
    expect(hintedTitle('Sanatani Holiday', hints.get(3))).toBe('Sanatani Holiday (Oct)');
    expect(hintedTitle('May Day', hints.get(4))).toBe('May Day');
  });
});
