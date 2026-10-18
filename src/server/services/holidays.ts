import 'server-only';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { compressAudience } from '@/core/calendar/compress';
import { findOverlaps, type Overlap, type OverlapInput } from '@/core/calendar/overlap';
import type { AudienceEntry, Structure } from '@/core/calendar/types';
import type {
  CheckOverlapInput,
  CreateHolidayInput,
  PatchHolidayInput,
} from '@/core/validation/holiday';
import { getDb, type Executor, type Tx } from '@/server/db/client';
import { getStructure } from '@/server/db/queries';
import { admins, auditLog, holidayAudience, holidays, series } from '@/server/db/schema';

// ---------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------

export interface Person {
  id: number;
  name: string;
}

export interface HolidayRecord {
  id: number;
  title: string;
  note: string | null;
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
  id: number;
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

export interface ServiceError {
  ok: false;
  code: 'NOT_FOUND' | 'UNPROCESSABLE' | 'BAD_REQUEST' | 'NOT_DELETED' | 'OVERLAP';
  message: string;
  conflicts?: Conflict[];
}
export type Result<T> = { ok: true; value: T } | ServiceError;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (
  code: ServiceError['code'],
  message: string,
  conflicts?: Conflict[],
): ServiceError => ({
  ok: false,
  code,
  message,
  conflicts,
});

// ---------------------------------------------------------------------------------------
// Serialising writes
// ---------------------------------------------------------------------------------------

// One fixed app-wide key. Every holiday write takes this lock first, inside its own
// transaction and BEFORE the overlap check; it is released automatically at commit or
// rollback. So "check overlaps, then write" runs one admin at a time and two admins can
// never both pass the check and then both save clashing holidays. Writes are rare, so the
// queueing costs nothing. This also stops an edit from racing with a delete or restore.
const WRITE_LOCK_KEY = 5_171_001;
const lockWrites = (tx: Tx) =>
  tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK_KEY}::bigint)`);

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

function toConflict(o: Overlap<HolidayRecord>, structure: Structure): Conflict {
  const h = o.holiday;
  return {
    id: h.id,
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
  const nearby = await fetchRecords(
    x,
    and(
      isNull(holidays.deletedAt),
      lte(holidays.startDate, candidate.endDate),
      gte(holidays.endDate, candidate.startDate),
    ),
  );
  return findOverlaps(candidate, nearby, structure, excludeId).map((o) => toConflict(o, structure));
}

/** Returns a message for the first audience id that does not exist (or is not active). */
async function audienceProblem(
  x: Executor,
  structure: Structure,
  audience: AudienceEntry[],
): Promise<string | null> {
  const facultyIds = new Set(structure.faculties.map((f) => f.id));
  const departmentIds = new Set(structure.departments.map((d) => d.id));
  const seriesIds = audience.filter((a) => a.scopeType === 'SERIES').map((a) => a.scopeId!);
  const seriesRows = seriesIds.length
    ? await x
        .select({ id: series.id, isActive: series.isActive })
        .from(series)
        .where(inArray(series.id, seriesIds))
    : [];
  const seriesState = new Map(seriesRows.map((s) => [s.id, s.isActive]));

  for (const a of audience) {
    const id = a.scopeId;
    if (a.scopeType === 'FACULTY' && !facultyIds.has(id!)) return `Faculty ${id} does not exist.`;
    if (a.scopeType === 'DEPARTMENT' && !departmentIds.has(id!)) {
      return `Department ${id} does not exist.`;
    }
    if (a.scopeType === 'SERIES') {
      if (!seriesState.has(id!)) return `Series ${id} does not exist.`;
      if (!seriesState.get(id!)) return `Series ${id} is not active.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------

const snapshot = (h: {
  title: string;
  note: string | null;
  startDate: string;
  endDate: string;
  audience: AudienceEntry[];
  deletedAt: string | null;
}) => ({
  title: h.title,
  note: h.note,
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
    const [row] = await tx
      .insert(holidays)
      .values({
        title: input.title,
        note,
        startDate: input.startDate,
        endDate: input.endDate,
        createdBy: adminId,
        updatedBy: adminId,
      })
      .returning({ id: holidays.id });
    const id = row!.id;
    await insertAudience(tx, id, input.audience);

    const after = snapshot({ ...input, note, deletedAt: null });
    await tx.insert(auditLog).values({
      adminId,
      action: 'CREATE',
      holidayId: id,
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
