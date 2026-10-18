import { compressAudience, coveredSeriesIds } from './compress';
import type { AudienceEntry, Structure } from './types';

export interface OverlapInput {
  startDate: string; // "YYYY-MM-DD": plain string comparison is correct for this format
  endDate: string;
  audience: AudienceEntry[];
}

export interface Overlap<T> {
  holiday: T;
  overlapStart: string;
  overlapEnd: string;
  /** The part of the audience both holidays share, compressed, e.g. `EEE-23`. */
  sharedLabel: string;
}

/**
 * Existing holidays that clash with `candidate`. Two holidays clash when their dates
 * intersect AND their audiences, expanded to ACTIVE series ids, share at least one id.
 * Pass `excludeId` when editing, so a holiday never clashes with itself.
 * Soft-deleted holidays must be filtered out by the caller.
 */
export function findOverlaps<T extends OverlapInput & { id: number }>(
  candidate: OverlapInput,
  existing: T[],
  structure: Structure,
  excludeId?: number,
): Overlap<T>[] {
  const mine = coveredSeriesIds(candidate.audience, structure);
  if (mine.size === 0) return [];

  const result: Overlap<T>[] = [];
  for (const h of existing) {
    if (h.id === excludeId) continue;
    if (!(candidate.startDate <= h.endDate && h.startDate <= candidate.endDate)) continue;

    const theirs = coveredSeriesIds(h.audience, structure);
    const shared = [...mine].filter((id) => theirs.has(id));
    if (shared.length === 0) continue;

    result.push({
      holiday: h,
      overlapStart: candidate.startDate > h.startDate ? candidate.startDate : h.startDate,
      overlapEnd: candidate.endDate < h.endDate ? candidate.endDate : h.endDate,
      sharedLabel: compressAudience(
        shared.map((id) => ({ scopeType: 'SERIES' as const, scopeId: id })),
        structure,
      ),
    });
  }
  return result.sort(
    (a, b) => a.holiday.startDate.localeCompare(b.holiday.startDate) || a.holiday.id - b.holiday.id,
  );
}
