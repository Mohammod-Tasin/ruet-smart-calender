import 'server-only';
import { inArray, sql } from 'drizzle-orm';
import type { AudienceEntry, Structure } from '@/core/calendar/types';
import type { Executor, Tx } from '@/server/db/client';
import { auditLog, series } from '@/server/db/schema';

export interface Person {
  id: number;
  name: string;
}

export interface ServiceError {
  ok: false;
  code: 'NOT_FOUND' | 'UNPROCESSABLE' | 'BAD_REQUEST' | 'NOT_DELETED' | 'OVERLAP';
  message: string;
  conflicts?: unknown[];
}
export type Result<T> = { ok: true; value: T } | ServiceError;

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (
  code: ServiceError['code'],
  message: string,
  conflicts?: unknown[],
): ServiceError => ({ ok: false, code, message, conflicts });

// One fixed app-wide key. Every holiday / rule write takes this lock first, inside its own
// transaction and BEFORE the overlap check; it is released automatically at commit or
// rollback. So "check overlaps, then write" runs one admin at a time and two admins can
// never both pass the check and then both save clashing holidays. Writes are rare, so the
// queueing costs nothing. This also stops an edit from racing with a delete or restore.
const WRITE_LOCK_KEY = 5_171_001;
export const lockWrites = (tx: Tx) =>
  tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK_KEY}::bigint)`);

/** Returns a message for the first audience id that does not exist (or is not active). */
export async function audienceProblem(
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

/** Non-holiday audit rows (rules and their overrides). Same transaction as the write. */
export const auditEntity = (
  tx: Tx,
  adminId: number,
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE',
  entityType:
    | 'RULE'
    | 'RULE_OVERRIDE'
    | 'SEMESTER'
    | 'SEMESTER_CHECKPOINT'
    | 'SEMESTER_WEEK_OVERRIDE'
    | 'SEMESTER_PIN'
    | 'SERIES_POSITION'
    | 'ACADEMIC_SETTINGS',
  entityId: number,
  before: unknown,
  after: unknown,
) => tx.insert(auditLog).values({ adminId, action, entityType, entityId, before, after });
