import 'server-only';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { AudienceEntry, Structure } from '@/core/calendar/types';
import { getDb } from './client';
import { departments, faculties, holidayAudience, holidays, series } from './schema';

export async function getStructure() {
  const db = getDb();
  const [facultyRows, departmentRows, seriesRows] = await Promise.all([
    db.select().from(faculties).orderBy(asc(faculties.sortOrder), asc(faculties.id)),
    db.select().from(departments).orderBy(asc(departments.code)),
    db.select().from(series).where(eq(series.isActive, true)).orderBy(asc(series.id)),
  ]);
  return { faculties: facultyRows, departments: departmentRows, series: seriesRows };
}

/** The slice of the structure the core compression logic needs. */
export function toCoreStructure(s: Awaited<ReturnType<typeof getStructure>>): Structure {
  return s;
}

export interface HolidayRow {
  id: number;
  title: string;
  startDate: string;
  endDate: string;
  audience: AudienceEntry[];
}

/** Holidays overlapping [from, to], not soft-deleted, each with its raw audience. */
export async function getHolidaysInRange(from: string, to: string): Promise<HolidayRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: holidays.id,
      title: holidays.title,
      startDate: holidays.startDate,
      endDate: holidays.endDate,
    })
    .from(holidays)
    .where(
      and(lte(holidays.startDate, to), gte(holidays.endDate, from), isNull(holidays.deletedAt)),
    )
    .orderBy(asc(holidays.startDate), asc(holidays.id));
  if (rows.length === 0) return [];

  const audienceRows = await db
    .select()
    .from(holidayAudience)
    .where(
      inArray(
        holidayAudience.holidayId,
        rows.map((r) => r.id),
      ),
    );
  const byHoliday = new Map<number, AudienceEntry[]>();
  for (const a of audienceRows) {
    const list = byHoliday.get(a.holidayId) ?? [];
    list.push({ scopeType: a.scopeType, scopeId: a.scopeId });
    byHoliday.set(a.holidayId, list);
  }
  return rows.map((r) => ({ ...r, audience: byHoliday.get(r.id) ?? [] }));
}
