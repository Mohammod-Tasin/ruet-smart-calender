import 'server-only';
import { and, inArray, isNull, sql } from 'drizzle-orm';
import { coveredSeriesIds } from '@/core/calendar/compress';
import { parseOffDays, todayInDhaka } from '@/core/calendar/grid';
import { needsPastConfirm, pastMessage } from '@/core/calendar/past';
import { trimRange as trimRangeCore, type DateRange } from '@/core/calendar/trim';
import type { AudienceEntry, Structure } from '@/core/calendar/types';
import type { Executor, Tx } from '@/server/db/client';
import { auditLog, series, seriesPositions } from '@/server/db/schema';

export interface Person {
  id: number;
  name: string;
}

export interface ServiceError {
  ok: false;
  code:
    | 'NOT_FOUND'
    | 'UNPROCESSABLE'
    | 'BAD_REQUEST'
    | 'NOT_DELETED'
    | 'OVERLAP'
    | 'PAST_CONFIRM'
    | 'CONFLICT';
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
    | 'RULE_EDIT'
    | 'SERIES_POSITION'
    | 'SERIES_SCHEDULE'
    | 'ACADEMIC_SETTINGS',
  entityId: number,
  before: unknown,
  after: unknown,
) => tx.insert(auditLog).values({ adminId, action, entityType, entityId, before, after });

/** Server-side trim of weekly off days (Thu/Fri) from a range before it is saved. */
export const trimRange = (r: DateRange) =>
  trimRangeCore(r, parseOffDays(process.env.WEEKLY_OFF_DAYS));
export const ALL_WEEKLY_OFF = 'Those days are all weekly holidays (Thursday and Friday).';

/**
 * The "Fix a past holiday" gate (enforced here, not just in the UI). null = go ahead. Otherwise a
 * PAST_CONFIRM failure whose message says how many series have a semester history that would be
 * recalculated; the client repeats the request with `confirmPast: true`.
 */
export async function pastGate(
  x: Executor,
  structure: Structure,
  opts: {
    today?: string;
    ranges: (DateRange | null | undefined)[];
    audiences: AudienceEntry[][];
    confirmed?: boolean;
  },
): Promise<ServiceError | null> {
  const today = opts.today ?? todayInDhaka();
  if (opts.confirmed || !needsPastConfirm(today, opts.ranges)) return null;
  const covered = new Set(opts.audiences.flatMap((a) => [...coveredSeriesIds(a, structure)]));
  const withHistory = covered.size
    ? await x
        .selectDistinct({ id: seriesPositions.seriesId })
        .from(seriesPositions)
        .where(
          and(inArray(seriesPositions.seriesId, [...covered]), isNull(seriesPositions.deletedAt)),
        )
    : [];
  return fail('PAST_CONFIRM', pastMessage(withHistory.length));
}
