import 'server-only';
import { appliesToSeries, compressAudience } from '@/core/calendar/compress';
import type { Category } from '@/core/calendar/rules';
import type { AudienceEntry } from '@/core/calendar/types';
import { getDb, type Executor } from '@/server/db/client';
import { getHolidaysInRange, getStructure } from '@/server/db/queries';
import { ruleOccurrences } from './rules';
import type { Person } from './shared';

export interface OffDay {
  /** number for a one-off holiday, "rule:<ruleId>:<year>" for a yearly rule */
  id: number | string;
  title: string;
  note: string | null;
  category: Category;
  classesOnly: boolean;
  startDate: string;
  endDate: string;
  audience: AudienceEntry[];
  label: string;
  source: 'ONE_OFF' | 'RULE';
  tentative: boolean;
  ruleId?: number;
  year?: number;
  updatedBy: Person;
  updatedAt: string;
}

/**
 * THE way to read holidays. Every consumer (public API, admin calendar, overlap check, the
 * future semester engine) goes through this: one-off holidays + yearly rules expanded for
 * the range + per-year overrides. `seriesId` keeps only what applies to that series.
 */
export async function getOffDays(
  range: { from: string; to: string },
  filter: { seriesId?: number } = {},
  x: Executor = getDb(),
): Promise<OffDay[]> {
  const [oneOffs, rules, structure] = await Promise.all([
    getHolidaysInRange(range.from, range.to, x),
    ruleOccurrences(x, range),
    getStructure(x),
  ]);

  const all: OffDay[] = [
    ...oneOffs.map((h) => ({
      ...h,
      category: h.category as Category,
      source: 'ONE_OFF' as const,
      tentative: false,
      label: compressAudience(h.audience, structure),
    })),
    ...rules.map((o) => ({
      ...o,
      source: 'RULE' as const,
      label: compressAudience(o.audience, structure),
    })),
  ];
  const wanted = filter.seriesId;
  return all
    .filter((h) => wanted === undefined || appliesToSeries(h.audience, structure, wanted))
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        String(a.id).localeCompare(String(b.id), undefined, { numeric: true }),
    );
}
