import { addDays, hijriMonthEnd, hijriToGregorian, hijriYearsAround, weekdayOf } from './hijri';
import type { AudienceEntry } from './types';

/** Add a category here (and its colour in src/lib/categories.ts). */
export const CATEGORIES = ['HOLIDAY'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface HijriPoint {
  month: number; // 1 = Muharram ... 9 = Ramadan ... 12 = Dhul-Hijjah
  day: number;
  offsetDays: number;
}
export type RuleParams =
  | { kind: 'GREGORIAN_FIXED'; month: number; day: number; lengthDays: number }
  | { kind: 'HIJRI'; startHijri: HijriPoint; endHijri: HijriPoint }
  | { kind: 'HIJRI'; type: 'LAST_WEEKDAY'; hijriMonth: number; weekday: number } // weekday 0 = Sunday
  | { kind: 'MANUAL_YEARLY'; defaultLengthDays: number };
export type RuleKind = RuleParams['kind'];

export interface RuleDef {
  id: number;
  title: string;
  category: Category;
  classesOnly: boolean;
  audience: AudienceEntry[];
  params: RuleParams;
  effectiveFromYear: number;
  effectiveToYear: number | null;
}

/** One year's exception to a rule. `startDate`/`endDate` are both set or both null. */
export interface RuleOverride {
  ruleId: number;
  year: number;
  startDate: string | null;
  endDate: string | null;
  skipped: boolean;
  confirmed: boolean;
  note: string | null;
}

export interface RuleDates {
  startDate: string;
  endDate: string;
}

/** What one rule does in one year: the computed dates, and what finally shows. */
export interface RuleYear {
  computed: RuleDates | null; // null for MANUAL_YEARLY
  final: (RuleDates & { tentative: boolean }) | null; // null = nothing shown that year
  skipped: boolean;
  confirmed: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const activeInYear = (r: RuleDef, year: number) =>
  year >= r.effectiveFromYear && (r.effectiveToYear === null || year <= r.effectiveToYear);

function hijriPoint(p: HijriPoint, hy: number, bd: number, nearYear: number) {
  return hijriToGregorian(hy, p.month, p.day, p.offsetDays + bd, nearYear);
}

/**
 * Dates a rule computes for Gregorian `year` (the year its start date falls in).
 * MANUAL_YEARLY has no computed dates. `bd` is HIJRI_BD_DAY_OFFSET.
 * ponytail: a Hijri date can fall twice in one Gregorian year (about once every 33 years);
 * only the first is used. Fix with a per-occurrence index if that ever matters.
 */
export function computeRuleDates(params: RuleParams, year: number, bd: number): RuleDates | null {
  if (params.kind === 'GREGORIAN_FIXED') {
    const startDate = `${year}-${pad(params.month)}-${pad(params.day)}`;
    return { startDate, endDate: addDays(startDate, params.lengthDays - 1) };
  }
  if (params.kind === 'MANUAL_YEARLY') return null;

  for (const hy of hijriYearsAround(year)) {
    let dates: RuleDates | null;
    if ('type' in params) {
      const end = hijriMonthEnd(hy, params.hijriMonth, bd, year);
      const start = hijriToGregorian(hy, params.hijriMonth, 1, bd, year);
      if (!end || !start) continue;
      let day = end;
      while (weekdayOf(day) !== params.weekday) day = addDays(day, -1);
      dates = day >= start ? { startDate: day, endDate: day } : null;
    } else {
      const startDate = hijriPoint(params.startHijri, hy, bd, year);
      const endDate = hijriPoint(params.endHijri, hy, bd, year);
      dates = startDate && endDate ? { startDate, endDate } : null;
    }
    if (dates && Number(dates.startDate.slice(0, 4)) === year) return dates;
  }
  return null;
}

/** Applies the year's override on top of the computed dates. */
export function resolveRuleYear(
  rule: RuleDef,
  year: number,
  override: RuleOverride | undefined,
  bd: number,
): RuleYear {
  const computed = computeRuleDates(rule.params, year, bd);
  const skipped = !!override?.skipped;
  const confirmed = !!override?.confirmed;
  const moved = override?.startDate && override.endDate ? override : null;
  const dates = moved ? { startDate: moved.startDate!, endDate: moved.endDate! } : computed;
  const tentative = rule.params.kind === 'HIJRI' && !confirmed;
  return {
    computed,
    skipped,
    confirmed,
    final: !skipped && dates && activeInYear(rule, year) ? { ...dates, tentative } : null,
  };
}

export interface RuleOccurrence extends RuleDates {
  id: string; // rule:<ruleId>:<year>
  ruleId: number;
  year: number;
  title: string;
  category: Category;
  classesOnly: boolean;
  audience: AudienceEntry[];
  tentative: boolean;
}

/** Occurrences of `rules` touching [from, to]. Nothing is pre-generated: this runs per request. */
export function expandRules(
  rules: RuleDef[],
  overrides: RuleOverride[],
  range: { from: string; to: string },
  bd: number,
): RuleOccurrence[] {
  const byKey = new Map(overrides.map((o) => [`${o.ruleId}:${o.year}`, o]));
  const y0 = Number(range.from.slice(0, 4)) - 1; // a rule year can spill into the next year
  const y1 = Number(range.to.slice(0, 4));
  const out: RuleOccurrence[] = [];
  for (const rule of rules) {
    for (let year = y0; year <= y1; year++) {
      const r = resolveRuleYear(rule, year, byKey.get(`${rule.id}:${year}`), bd).final;
      if (!r || r.startDate > range.to || r.endDate < range.from) continue;
      out.push({
        id: `rule:${rule.id}:${year}`,
        ruleId: rule.id,
        year,
        title: rule.title,
        category: rule.category,
        classesOnly: rule.classesOnly,
        audience: rule.audience,
        startDate: r.startDate,
        endDate: r.endDate,
        tentative: r.tentative,
      });
    }
  }
  return out;
}

/** MANUAL_YEARLY rules active in `year` that have no dates yet ("Dates needed"). */
export function missingManualDates(
  rules: RuleDef[],
  overrides: RuleOverride[],
  year: number,
): RuleDef[] {
  return rules.filter((r) => {
    if (r.params.kind !== 'MANUAL_YEARLY' || !activeInYear(r, year)) return false;
    const o = overrides.find((x) => x.ruleId === r.id && x.year === year);
    return !o?.skipped && !(o?.startDate && o.endDate);
  });
}

// --- Versioning: past years never change ----------------------------------------------------

export type EditPlan = { mode: 'IN_PLACE' } | { mode: 'SPLIT'; oldEffectiveTo: number };
export type EndPlan = { mode: 'SOFT_DELETE' } | { mode: 'END'; effectiveTo: number };

/** Editing a rule "from year Y onward". */
export function planEdit(rule: Pick<RuleDef, 'effectiveFromYear'>, fromYear: number): EditPlan {
  return fromYear <= rule.effectiveFromYear
    ? { mode: 'IN_PLACE' }
    : { mode: 'SPLIT', oldEffectiveTo: fromYear - 1 };
}

/** Ending a rule "from year Y onward". */
export function planEnd(rule: Pick<RuleDef, 'effectiveFromYear'>, fromYear: number): EndPlan {
  return fromYear <= rule.effectiveFromYear
    ? { mode: 'SOFT_DELETE' }
    : { mode: 'END', effectiveTo: fromYear - 1 };
}

export const shiftDates = (d: RuleDates, n: number): RuleDates => ({
  startDate: addDays(d.startDate, n),
  endDate: addDays(d.endDate, n),
});
