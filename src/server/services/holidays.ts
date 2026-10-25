import 'server-only';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { compressAudience } from '@/core/calendar/compress';
import { findOverlaps, type Overlap, type OverlapInput } from '@/core/calendar/overlap';
import type { Category } from '@/core/calendar/rules';
import type { AudienceEntry, Structure } from '@/core/calendar/types';
import type {
  CheckOverlapInput,
  CreateHolidayInput,
  PatchHolidayInput,
} from '@/core/validation/holiday';
import { getDb, type Executor, type Tx } from '@/server/db/client';
import { getStructure } from '@/server/db/queries';
import { admins, auditLog, holidayAudience, holidays } from '@/server/db/schema';
import { ruleOccurrences } from './rules';
import { audienceProblem, fail, lockWrites, ok, type Person, type Result } from './shared';

export type { Person, Result, ServiceError } from './shared';

// ---------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------

export interface HolidayRecord {
  id: number;
  title: string;
  note: string | null;
  category: Category;
  classesOnly: boolean;
  startDate: string;
  endDate: string;
  audience: AudienceEntry[];
  createdBy: Person;
  createdAt: string;
  updatedBy: Person;
  updatedAt: string;
  deletedAt: string | null;
}

export interface HolidayView extends HolidayRecord {
  label: string;
}

export interface Conflict {
  id: number | string; // string = a yearly-rule occurrence, "rule:<id>:<year>"
  source: 'ONE_OFF' | 'RULE';
  title: string;
  note: string | null;
  startDate: string;
  endDate: string;
  label: string;
  createdBy: Person;
  createdAt: string;
  updatedBy: Person;
  updatedAt: string;
  overlap: { startDate: string; endDate: string };
  sharedLabel: string;
}

// ---------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------

async function fetchRecords(x: Executor, where: SQL | undefined): Promise<HolidayRecord[]> {
  const creator = alias(admins, 'creator');
  const updater = alias(admins, 'updater');
  const rows = await x
    .select({
      id: holidays.id,
      title: holidays.title,
      note: holidays.note,
      category: holidays.category,
      classesOnly: holidays.classesOnly,
      startDate: holidays.startDate,
      endDate: holidays.endDate,
      createdById: holidays.createdBy,
      createdByName: creator.name,
      createdAt: holidays.createdAt,
      updatedById: holidays.updatedBy,
      updatedByName: updater.name,
      updatedAt: holidays.updatedAt,
      deletedAt: holidays.deletedAt,
    })
    .from(holidays)
    .innerJoin(creator, eq(creator.id, holidays.createdBy))
    .innerJoin(updater, eq(updater.id, holidays.updatedBy))
    .where(where)
    .orderBy(asc(holidays.startDate), asc(holidays.id));
  if (rows.length === 0) return [];

  const audienceRows = await x
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

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    note: r.note,
    category: r.category as Category,
    classesOnly: r.classesOnly,
    startDate: r.startDate,
    endDate: r.endDate,
    audience: byHoliday.get(r.id) ?? [],
    createdBy: { id: r.createdById, name: r.createdByName },
    createdAt: r.createdAt.toISOString(),
    updatedBy: { id: r.updatedById, name: r.updatedByName },
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }));
}

async function fetchOne(x: Executor, id: number): Promise<HolidayRecord | null> {
  return (await fetchRecords(x, eq(holidays.id, id)))[0] ?? null;
}

const view = (r: HolidayRecord, structure: Structure): HolidayView => ({
  ...r,
  label: compressAudience(r.audience, structure),
});

// ---------------------------------------------------------------------------------------
// Overlaps and validation against the database
// ---------------------------------------------------------------------------------------

type Clashable = Omit<Conflict, 'label' | 'overlap' | 'sharedLabel'> & {
  audience: AudienceEntry[];
};

function toConflict(o: Overlap<Clashable>, structure: Structure): Conflict {
  const h = o.holiday;
  return {
    id: h.id,
    source: h.source,
    title: h.title,
    note: h.note,
    startDate: h.startDate,
    endDate: h.endDate,
    label: compressAudience(h.audience, structure),
    createdBy: h.createdBy,
    createdAt: h.createdAt,
    updatedBy: h.updatedBy,
    updatedAt: h.updatedAt,
    overlap: { startDate: o.overlapStart, endDate: o.overlapEnd },
    sharedLabel: o.sharedLabel,
  };
}

async function conflictsFor(
  x: Executor,
  structure: Structure,
  candidate: OverlapInput,
  excludeId?: number,
): Promise<Conflict[]> {
  // Only live holidays whose dates touch the candidate can clash; the core does the rest.
  // Yearly-rule occurrences count too (same sources as getOffDays); they have no separate
  // author, so the editor of the rule / override stands in for createdBy.
  const [oneOffs, ruleOccs] = await Promise.all([
    fetchRecords(
      x,
      and(
        isNull(holidays.deletedAt),
        lte(holidays.startDate, candidate.endDate),
        gte(holidays.endDate, candidate.startDate),
      ),
    ),
    ruleOccurrences(x, { from: candidate.startDate, to: candidate.endDate }),
  ]);
  const nearby: Clashable[] = [
    ...oneOffs.map((h) => ({ ...h, source: 'ONE_OFF' as const })),
    ...ruleOccs.map((o) => ({
      ...o,
      source: 'RULE' as const,
      createdBy: o.updatedBy,
      createdAt: o.updatedAt,
    })),
  ];
  return findOverlaps(candidate, nearby, structure, excludeId).map((o) => toConflict(o, structure));
}

// ---------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------

const snapshot = (h: {
  title: string;
  note: string | null;
  category: string;
  classesOnly: boolean;
  startDate: string;
  endDate: string;
  audience: AudienceEntry[];
  deletedAt: string | null;
}) => ({
  title: h.title,
  note: h.note,
  category: h.category,
  classesOnly: h.classesOnly,
  startDate: h.startDate,
  endDate: h.endDate,
  audience: h.audience,
  deletedAt: h.deletedAt,
});

const withConfirmed = (after: object, conflicts: Conflict[]) =>
  conflicts.length > 0 ? { ...after, confirmedOverlapWith: conflicts.map((c) => c.id) } : after;

const insertAudience = (tx: Tx, holidayId: number, audience: AudienceEntry[]) =>
  tx.insert(holidayAudience).values(audience.map((a) => ({ holidayId, ...a })));

export async function createHoliday(
  adminId: number,
  input: CreateHolidayInput,
): Promise<Result<{ holiday: HolidayView }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const structure = await getStructure(tx);

    const problem = await audienceProblem(tx, structure, input.audience);
    if (problem) return fail('UNPROCESSABLE', problem);

    const conflicts = await conflictsFor(tx, structure, input);
    if (conflicts.length > 0 && !input.confirmOverlap) {
      return fail('OVERLAP', 'This overlaps existing holidays.', conflicts);
    }

    const note = input.note ?? null;
    const category = input.category ?? 'HOLIDAY';
    const classesOnly = input.classesOnly ?? false;
    const [row] = await tx
      .insert(holidays)
      .values({
        title: input.title,
        note,
        category,
        classesOnly,
        startDate: input.startDate,
        endDate: input.endDate,
        createdBy: adminId,
        updatedBy: adminId,
      })
      .returning({ id: holidays.id });
    const id = row!.id;
    await insertAudience(tx, id, input.audience);

    const after = snapshot({ ...input, note, category, classesOnly, deletedAt: null });
    await tx.insert(auditLog).values({
      adminId,
      action: 'CREATE',
      holidayId: id,
      entityId: id,
      before: null,
      after: withConfirmed(after, conflicts),
    });

    return ok({ holiday: view((await fetchOne(tx, id))!, structure) });
  });
}

export async function updateHoliday(
  adminId: number,
  id: number,
  patch: PatchHolidayInput,
): Promise<Result<{ holiday: HolidayView }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const existing = await fetchOne(tx, id);
    if (!existing || existing.deletedAt) return fail('NOT_FOUND', 'Holiday not found.');

    const merged = {
      title: patch.title ?? existing.title,
      note: patch.note !== undefined ? patch.note : existing.note,
      category: patch.category ?? existing.category,
      classesOnly: patch.classesOnly ?? existing.classesOnly,
      startDate: patch.startDate ?? existing.startDate,
      endDate: patch.endDate ?? existing.endDate,
      audience: patch.audience ?? existing.audience,
    };
    if (merged.endDate < merged.startDate) {
      return fail('BAD_REQUEST', 'endDate must be on or after startDate.');
    }

    const structure = await getStructure(tx);
    if (patch.audience) {
      const problem = await audienceProblem(tx, structure, patch.audience);
      if (problem) return fail('UNPROCESSABLE', problem);
    }

    // A title or note edit cannot create a new overlap, so only dates/audience changes check.
    const movesDatesOrAudience =
      patch.startDate !== undefined || patch.endDate !== undefined || patch.audience !== undefined;
    const conflicts = movesDatesOrAudience ? await conflictsFor(tx, structure, merged, id) : [];
    if (conflicts.length > 0 && !patch.confirmOverlap) {
      return fail('OVERLAP', 'This overlaps existing holidays.', conflicts);
    }

    await tx
      .update(holidays)
      .set({
        title: merged.title,
        note: merged.note,
        category: merged.category,
        classesOnly: merged.classesOnly,
        startDate: merged.startDate,
        endDate: merged.endDate,
        updatedBy: adminId,
        updatedAt: sql`now()`,
      })
      .where(eq(holidays.id, id));
    if (patch.audience) {
      await tx.delete(holidayAudience).where(eq(holidayAudience.holidayId, id));
      await insertAudience(tx, id, patch.audience);
    }

    await tx.insert(auditLog).values({
      adminId,
      action: 'UPDATE',
      holidayId: id,
      entityId: id,
      before: snapshot(existing),
      after: withConfirmed(snapshot({ ...merged, deletedAt: null }), conflicts),
    });

    return ok({ holiday: view((await fetchOne(tx, id))!, structure) });
  });
}

export async function deleteHoliday(
  adminId: number,
  id: number,
): Promise<Result<{ holiday: HolidayView }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const existing = await fetchOne(tx, id);
    if (!existing || existing.deletedAt) return fail('NOT_FOUND', 'Holiday not found.');

    await tx
      .update(holidays)
      .set({ deletedAt: sql`now()`, updatedBy: adminId, updatedAt: sql`now()` })
      .where(eq(holidays.id, id));
    const after = (await fetchOne(tx, id))!;
    await tx.insert(auditLog).values({
      adminId,
      action: 'DELETE',
      holidayId: id,
      entityId: id,
      before: snapshot(existing),
      after: snapshot(after),
    });

    return ok({ holiday: view(after, await getStructure(tx)) });
  });
}

/** Restoring never blocks; `conflicts` is information so the UI can warn about clashes. */
export async function restoreHoliday(
  adminId: number,
  id: number,
): Promise<Result<{ holiday: HolidayView; conflicts: Conflict[] }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const existing = await fetchOne(tx, id);
    if (!existing) return fail('NOT_FOUND', 'Holiday not found.');
    if (!existing.deletedAt) return fail('NOT_DELETED', 'Holiday is not deleted.');

    await tx
      .update(holidays)
      .set({ deletedAt: null, updatedBy: adminId, updatedAt: sql`now()` })
      .where(eq(holidays.id, id));
    const after = (await fetchOne(tx, id))!;
    await tx.insert(auditLog).values({
      adminId,
      action: 'RESTORE',
      holidayId: id,
      entityId: id,
      before: snapshot(existing),
      after: snapshot(after),
    });

    const structure = await getStructure(tx);
    return ok({
      holiday: view(after, structure),
      conflicts: await conflictsFor(tx, structure, after, id),
    });
  });
}

// ---------------------------------------------------------------------------------------
// Read-only
// ---------------------------------------------------------------------------------------

/** Includes soft-deleted holidays, so the admin UI can offer "restore". */
export async function getHoliday(id: number): Promise<Result<{ holiday: HolidayView }>> {
  const db = getDb();
  const record = await fetchOne(db, id);
  if (!record) return fail('NOT_FOUND', 'Holiday not found.');
  return ok({ holiday: view(record, await getStructure(db)) });
}

export async function checkOverlap(
  input: CheckOverlapInput,
): Promise<Result<{ conflicts: Conflict[] }>> {
  const db = getDb();
  const structure = await getStructure(db);
  const problem = await audienceProblem(db, structure, input.audience);
  if (problem) return fail('UNPROCESSABLE', problem);
  return ok({ conflicts: await conflictsFor(db, structure, input, input.excludeId) });
}

/** Soft-deleted holidays, most recently deleted first (for the "Recently deleted" list). */
export async function listDeleted(): Promise<{ holidays: HolidayView[] }> {
  const db = getDb();
  const [records, structure] = await Promise.all([
    fetchRecords(db, isNotNull(holidays.deletedAt)),
    getStructure(db),
  ]);
  const recent = records.sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!)).slice(0, 30);
  return { holidays: recent.map((r) => view(r, structure)) };
}
