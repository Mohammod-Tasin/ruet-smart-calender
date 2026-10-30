import { msOf } from '../calendar/hijri';
import type { AudienceEntry } from '../calendar/types';
import type { Journey, JPhase } from './journey';

// Impact preview on the journey engine. Same response shape as the Phase 10 impact
// ({ groups: [{ endShiftWeeks, changes, seriesIds, labels }] }), so the holiday forms keep
// working; `changes` also carries `semesterNo` and phases may now be EXAM.

export interface JourneyChange {
  semesterNo: number;
  /** semesterNo * 10 + structure block: unique per block, stable across a diff. */
  segment: number;
  phase: JPhase;
  before: string | null;
  after: string | null;
}
export interface JourneyDiff {
  /** Weeks graduation moves (negative = earlier). null if unknown. */
  endShiftWeeks: number | null;
  changes: JourneyChange[];
}
export interface ImpactGroup extends JourneyDiff {
  seriesIds: number[];
  labels: string[];
}

interface Mark {
  semesterNo: number;
  block: number;
  phase: JPhase;
  date: string;
}

/** First counted week of each structure block, for the semesters from `fromSemester` to the next. */
function marks(j: Journey, fromSemester: number): Mark[] {
  const seen = new Set<string>();
  const out: Mark[] = [];
  for (const w of j.weeks) {
    const key = `${w.semesterNo}:${w.block}`;
    if (w.status !== 'COUNTED' || w.semesterNo < fromSemester || w.semesterNo > fromSemester + 1)
      continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ semesterNo: w.semesterNo, block: w.block, phase: w.phase, date: w.weekStart });
  }
  return out;
}

/**
 * What a change does to one series: block start dates of its current and next semester that
 * moved, and how many weeks graduation moves. null when nothing changes.
 */
export function diffJourneys(
  before: Journey,
  after: Journey,
  currentSemester: number,
): JourneyDiff | null {
  const a = marks(before, currentSemester);
  const b = marks(after, currentSemester);
  const changes: JourneyChange[] = [];
  for (const m of a) {
    const n = b.find((x) => x.semesterNo === m.semesterNo && x.block === m.block);
    if (n?.date !== m.date) {
      changes.push({
        semesterNo: m.semesterNo,
        segment: m.semesterNo * 10 + m.block,
        phase: m.phase,
        before: m.date,
        after: n?.date ?? null,
      });
    }
  }
  const shift =
    before.graduation && after.graduation
      ? Math.round((msOf(after.graduation) - msOf(before.graduation)) / (7 * 86_400_000))
      : null;
  if (changes.length === 0 && !shift) return null;
  return { endShiftWeeks: shift, changes };
}

/** Series with the identical effect are reported together: "EEE-21, EEE-22: +1 week". */
export function groupImpacts(
  items: { seriesId: number; label: string; diff: JourneyDiff }[],
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
