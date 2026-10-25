import { msOf } from '../calendar/hijri';
import type { AudienceEntry } from '../calendar/types';
import type { Phase, Timeline } from './timeline';

// Impact preview (spec §4.6): what a proposed holiday change does to semester timelines.

export interface Milestone {
  segment: number;
  phase: Phase;
  date: string;
}

/** Start date of each template block = its first counted week. */
export function milestones(tl: Timeline): Milestone[] {
  const seen = new Set<number>();
  const out: Milestone[] = [];
  for (const w of tl.weeks) {
    if (w.status !== 'COUNTED' || seen.has(w.segment)) continue;
    seen.add(w.segment);
    out.push({ segment: w.segment, phase: w.phase, date: w.weekStart });
  }
  return out;
}

export interface TimelineDiff {
  /** How many weeks the end of the semester moves (negative = earlier). null if unknown. */
  endShiftWeeks: number | null;
  changes: { segment: number; phase: Phase; before: string | null; after: string | null }[];
}

/** null when nothing changes. */
export function diffTimelines(before: Timeline, after: Timeline): TimelineDiff | null {
  const a = milestones(before);
  const b = milestones(after);
  const changes: TimelineDiff['changes'] = [];
  for (const m of a) {
    const n = b.find((x) => x.segment === m.segment);
    if (n?.date !== m.date) {
      changes.push({ segment: m.segment, phase: m.phase, before: m.date, after: n?.date ?? null });
    }
  }
  for (const n of b) {
    if (!a.some((x) => x.segment === n.segment)) {
      changes.push({ segment: n.segment, phase: n.phase, before: null, after: n.date });
    }
  }
  const shift =
    before.completed && after.completed
      ? Math.round((msOf(after.endDate) - msOf(before.endDate)) / (7 * 86_400_000))
      : null;
  if (changes.length === 0 && !shift) return null;
  changes.sort((x, y) => x.segment - y.segment);
  return { endShiftWeeks: shift, changes };
}

export interface ImpactGroup extends TimelineDiff {
  seriesIds: number[];
  labels: string[];
}

/** Series with the identical effect are reported together: "EEE-21, EEE-22: +1 week". */
export function groupImpacts(
  items: { seriesId: number; label: string; diff: TimelineDiff }[],
): ImpactGroup[] {
  const groups = new Map<string, ImpactGroup>();
  for (const { seriesId, label, diff } of items) {
    const key = JSON.stringify(diff);
    const g = groups.get(key) ?? { ...diff, seriesIds: [], labels: [] };
    g.seriesIds.push(seriesId);
    g.labels.push(label);
    groups.set(key, g);
  }
  return [...groups.values()].sort((x, y) => (y.endShiftWeeks ?? 0) - (x.endShiftWeeks ?? 0));
}

// --- Applying a proposed change to a list of off days ----------------------------------------

export interface ProposedChange {
  /** Ids of existing holidays / rule occurrences ("rule:3:2026") that go away. */
  removeIds?: (number | string)[];
  /** Holidays that would be added. Editing = remove the old one and add the new one. */
  add?: { startDate: string; endDate: string; audience: AudienceEntry[]; title?: string }[];
}

export interface OffItem {
  id: number | string;
  title: string;
  startDate: string;
  endDate: string;
  audience: AudienceEntry[];
}

export function applyChange(items: OffItem[], change: ProposedChange): OffItem[] {
  const gone = new Set((change.removeIds ?? []).map(String));
  const kept = items.filter((x) => !gone.has(String(x.id)));
  const added = (change.add ?? []).map((a, i) => ({
    id: `proposed:${i}`,
    title: a.title ?? 'Proposed holiday',
    startDate: a.startDate,
    endDate: a.endDate,
    audience: a.audience,
  }));
  return [...kept, ...added];
}
