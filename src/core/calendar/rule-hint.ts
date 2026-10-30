import { monthShort } from './months';
import { activeInYear, resolveRuleYear, type RuleDef, type RuleOverride } from './rules';

/**
 * Rules that share a title (the three "Sanatani Holiday" rules) get a month hint taken from the
 * rule's most recent occurrence: "Jan", "Sep", "Oct". Rules with a unique title get none.
 */
export function ruleMonthHints(
  rules: RuleDef[],
  overrides: RuleOverride[],
  year: number,
  bd: number,
): Map<number, string> {
  const count = new Map<string, number>();
  for (const r of rules) count.set(r.title, (count.get(r.title) ?? 0) + 1);
  const hints = new Map<number, string>();
  for (const r of rules) {
    if ((count.get(r.title) ?? 0) < 2) continue;
    for (let y = year + 1; y >= year - 10; y--) {
      if (!activeInYear(r, y)) continue;
      const start = resolveRuleYear(
        r,
        y,
        overrides.find((o) => o.ruleId === r.id && o.year === y),
        bd,
      ).final?.startDate;
      if (start) {
        hints.set(r.id, monthShort(start));
        break;
      }
    }
  }
  return hints;
}

/** "Sanatani Holiday (Oct)" or just the title. */
export const hintedTitle = (title: string, hint: string | undefined | null) =>
  hint ? `${title} (${hint})` : title;
