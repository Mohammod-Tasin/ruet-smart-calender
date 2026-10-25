import 'server-only';
import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { coveredSeriesIds } from '@/core/calendar/compress';
import { parseOffDays, todayInDhaka } from '@/core/calendar/grid';
import { addDays } from '@/core/calendar/hijri';
import type { Structure } from '@/core/calendar/types';
import {
  applyChange,
  diffTimelines,
  groupImpacts,
  type ImpactGroup,
  type OffItem,
  type ProposedChange,
} from '@/core/semester/impact';
import {
  computeTimeline,
  DEFAULT_TEMPLATE,
  stateOn,
  weekStartOf,
  type Checkpoint,
  type Phase,
  type Pin,
  type SemesterState,
  type Template,
  type Timeline,
  type WeekOverride,
} from '@/core/semester/timeline';
import type {
  BulkCheckpointInput,
  BulkStartInput,
  PatchSemesterInput,
  PinInput,
  WeekOverrideInput,
} from '@/core/validation/semesters';
import { getDb, type Executor, type Tx } from '@/server/db/client';
import { getStructure } from '@/server/db/queries';
import {
  semesterCheckpoints,
  semesterPins,
  semesters,
  semesterWeekOverrides,
} from '@/server/db/schema';
import { getOffDays } from './off-days';
import { auditEntity, fail, lockWrites, ok, type Result } from './shared';

// ---------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------

export interface SemesterRecord {
  id: number;
  seriesId: number;
  label: string | null;
  startDate: string;
  template: Template;
  status: 'ACTIVE' | 'COMPLETED';
  updatedAt: string;
  checkpoints: (Checkpoint & { id: number; note: string | null })[];
  weekOverrides: (WeekOverride & { note: string | null })[];
  pins: (Pin & { note: string | null })[];
}

async function fetchSemesters(x: Executor, where?: SQL): Promise<SemesterRecord[]> {
  const rows = await x
    .select()
    .from(semesters)
    .where(and(isNull(semesters.deletedAt), where))
    .orderBy(asc(semesters.id));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [cps, ovs, pins] = await Promise.all([
    x
      .select()
      .from(semesterCheckpoints)
      .where(inArray(semesterCheckpoints.semesterId, ids))
      .orderBy(asc(semesterCheckpoints.asOfDate), asc(semesterCheckpoints.id)),
    x.select().from(semesterWeekOverrides).where(inArray(semesterWeekOverrides.semesterId, ids)),
    x.select().from(semesterPins).where(inArray(semesterPins.semesterId, ids)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    seriesId: r.seriesId,
    label: r.label,
    startDate: r.startDate,
    template: r.template,
    status: r.status,
    updatedAt: r.updatedAt.toISOString(),
    checkpoints: cps
      .filter((c) => c.semesterId === r.id)
      .map((c) => ({
        id: c.id,
        asOfDate: c.asOfDate,
        phase: c.phase as Phase,
        weekIndex: c.weekIndex,
        note: c.note,
      })),
    weekOverrides: ovs
      .filter((o) => o.semesterId === r.id)
      .map((o) => ({ weekStart: o.weekStart, mode: o.mode, note: o.note })),
    pins: pins
      .filter((p) => p.semesterId === r.id)
      .map((p) => ({ phase: p.phase as Phase, startDate: p.startDate, note: p.note })),
  }));
}

const fetchOne = async (x: Executor, id: number) =>
  (await fetchSemesters(x, eq(semesters.id, id)))[0] ?? null;

export function seriesLabel(
  structure: Structure & { departments: { code: string }[] },
  id: number,
) {
  const s = structure.series.find((x) => x.id === id);
  const d = s && structure.departments.find((x) => x.id === s.departmentId);
  return s && d ? `${d.code}-${String(s.intakeYear % 100).padStart(2, '0')}` : `#${id}`;
}

// ---------------------------------------------------------------------------------------
// Timelines (off days come from getOffDays, filtered by each series' audience)
// ---------------------------------------------------------------------------------------

const totalWeeks = (t: Template) => t.reduce((n, p) => n + p.weeks, 0);

/** Wide enough for any semester to finish, with room for long vacations. */
function rangeFor(list: SemesterRecord[]) {
  const from = list.reduce((m, s) => (s.startDate < m ? s.startDate : m), list[0]!.startDate);
  const to = list.reduce((m, s) => {
    const end = addDays(s.startDate, (totalWeeks(s.template) + 60) * 7);
    return end > m ? end : m;
  }, list[0]!.startDate);
  return { from: addDays(from, -7), to };
}

async function loadOffItems(x: Executor, range: { from: string; to: string }): Promise<OffItem[]> {
  const days = await getOffDays(range, {}, x);
  return days.map((d) => ({
    id: d.id,
    title: d.title,
    startDate: d.startDate,
    endDate: d.endDate,
    audience: d.audience,
  }));
}

/** Per series: date -> holiday titles that apply to that series. */
function lookups(items: OffItem[], structure: Structure, seriesIds: number[]) {
  const byDate = new Map(seriesIds.map((id) => [id, new Map<string, string[]>()]));
  for (const h of items) {
    const covered = coveredSeriesIds(h.audience, structure);
    for (const id of seriesIds) {
      if (!covered.has(id)) continue;
      const days = byDate.get(id)!;
      for (let d = h.startDate; d <= h.endDate; d = addDays(d, 1)) {
        days.set(d, [...(days.get(d) ?? []), h.title]);
      }
    }
  }
  return byDate;
}

function timelineOf(s: SemesterRecord, days: Map<string, string[]>): Timeline {
  return computeTimeline({
    startDate: s.startDate,
    template: s.template,
    isOffDay: (d) => days.has(d),
    titlesOn: (d) => days.get(d) ?? [],
    weeklyOff: parseOffDays(process.env.WEEKLY_OFF_DAYS),
    checkpoints: s.checkpoints,
    weekOverrides: s.weekOverrides,
    pins: s.pins,
  });
}

async function timelinesFor(x: Executor, list: SemesterRecord[], change?: ProposedChange) {
  if (list.length === 0) return { structure: await getStructure(x), result: [] };
  const [structure, base] = await Promise.all([getStructure(x), loadOffItems(x, rangeFor(list))]);
  const items = change ? applyChange(base, change) : base;
  const byDate = lookups(items, structure, [...new Set(list.map((s) => s.seriesId))]);
  return {
    structure,
    result: list.map((s) => ({ semester: s, timeline: timelineOf(s, byDate.get(s.seriesId)!) })),
  };
}

// ---------------------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------------------

export type StatusPhase = SemesterState['phase'] | 'COMPLETED' | 'AWAITING_NEXT';

export async function statusOn(date: string = todayInDhaka()) {
  const db = getDb();
  const all = await fetchSemesters(db);
  // One semester per series: the ACTIVE one, else a recently completed one.
  const recent = addDays(date, -60);
  const pick = new Map<number, SemesterRecord>();
  for (const s of all) {
    const have = pick.get(s.seriesId);
    if (s.status === 'ACTIVE') pick.set(s.seriesId, s);
    else if (!have && s.updatedAt.slice(0, 10) >= recent) pick.set(s.seriesId, s);
  }
  const { structure, result } = await timelinesFor(db, [...pick.values()]);

  const series = result.map(({ semester: s, timeline }) => {
    const state = stateOn(timeline, s.template, date);
    const phase: StatusPhase =
      s.status === 'COMPLETED'
        ? 'COMPLETED'
        : state.phase === 'ENDED'
          ? 'AWAITING_NEXT'
          : state.phase;
    return {
      seriesId: s.seriesId,
      series: seriesLabel(structure, s.seriesId),
      semesterId: s.id,
      label: s.label,
      status: s.status,
      state: { ...state, phase },
    };
  });
  const summary: Record<string, number> = {};
  for (const x of series) summary[x.state.phase] = (summary[x.state.phase] ?? 0) + 1;
  return { date, summary, series };
}

export async function semesterTimeline(id: number, date: string = todayInDhaka()) {
  const db = getDb();
  const s = await fetchOne(db, id);
  if (!s) return fail('NOT_FOUND', 'Semester not found.');
  const { structure, result } = await timelinesFor(db, [s]);
  const { timeline } = result[0]!;
  return ok({
    semester: {
      id: s.id,
      seriesId: s.seriesId,
      series: seriesLabel(structure, s.seriesId),
      label: s.label,
      startDate: s.startDate,
      status: s.status,
      template: s.template,
    },
    ...timeline,
    state: stateOn(timeline, s.template, date),
  });
}

// ---------------------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------------------

export async function listSemesters(seriesId?: number) {
  const list = await fetchSemesters(
    getDb(),
    seriesId === undefined ? undefined : eq(semesters.seriesId, seriesId),
  );
  return { semesters: list.sort((a, b) => b.id - a.id) };
}

export async function computeImpact(change: ProposedChange): Promise<{ groups: ImpactGroup[] }> {
  const db = getDb();
  const active = await fetchSemesters(db, eq(semesters.status, 'ACTIVE'));
  if (active.length === 0) return { groups: [] };
  const { structure, result: before } = await timelinesFor(db, active);
  const { result: after } = await timelinesFor(db, active, change);
  const items = before.flatMap(({ semester: s, timeline }, i) => {
    const diff = diffTimelines(timeline, after[i]!.timeline);
    return diff ? [{ seriesId: s.seriesId, label: seriesLabel(structure, s.seriesId), diff }] : [];
  });
  return { groups: groupImpacts(items) };
}

// ---------------------------------------------------------------------------------------
// Writes (lock, write, audit: one transaction)
// ---------------------------------------------------------------------------------------

const snap = (s: Pick<SemesterRecord, 'label' | 'startDate' | 'template' | 'status'>) => ({
  label: s.label,
  startDate: s.startDate,
  template: s.template,
  status: s.status,
});

/** Start a semester for each selected series. All or nothing. */
export async function bulkStart(
  adminId: number,
  input: BulkStartInput,
): Promise<Result<{ semesterIds: number[] }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const structure = await getStructure(tx);
    const seriesIds = [...new Set(input.seriesIds)];
    const unknown = seriesIds.filter((id) => !structure.series.some((s) => s.id === id));
    if (unknown.length)
      return fail('UNPROCESSABLE', `Unknown or inactive series: ${unknown.join(', ')}.`);

    const running = await fetchSemesters(
      tx,
      and(inArray(semesters.seriesId, seriesIds), eq(semesters.status, 'ACTIVE')),
    );
    if (running.length) {
      const names = running.map((r) => seriesLabel(structure, r.seriesId)).join(', ');
      return fail('UNPROCESSABLE', `Already has an active semester: ${names}. Complete it first.`);
    }

    const template = input.template ?? DEFAULT_TEMPLATE;
    const rows = await tx
      .insert(semesters)
      .values(
        seriesIds.map((seriesId) => ({
          seriesId,
          label: input.label ?? null,
          startDate: input.startDate,
          template,
          createdBy: adminId,
          updatedBy: adminId,
        })),
      )
      .returning({ id: semesters.id, seriesId: semesters.seriesId });
    for (const r of rows) {
      await auditEntity(tx, adminId, 'CREATE', 'SEMESTER', r.id, null, {
        seriesId: r.seriesId,
        ...snap({
          label: input.label ?? null,
          startDate: input.startDate,
          template,
          status: 'ACTIVE',
        }),
      });
    }
    return ok({ semesterIds: rows.map((r) => r.id) });
  });
}

async function live(tx: Tx, id: number) {
  return fetchOne(tx, id);
}

export async function updateSemester(
  adminId: number,
  id: number,
  patch: PatchSemesterInput,
): Promise<Result<{ semesterId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const cur = await live(tx, id);
    if (!cur) return fail('NOT_FOUND', 'Semester not found.');
    const next = {
      label: patch.label !== undefined ? patch.label : cur.label,
      startDate: patch.startDate ?? cur.startDate,
      template: patch.template ?? cur.template,
    };
    await tx
      .update(semesters)
      .set({ ...next, updatedBy: adminId, updatedAt: new Date() })
      .where(eq(semesters.id, id));
    await auditEntity(
      tx,
      adminId,
      'UPDATE',
      'SEMESTER',
      id,
      snap(cur),
      snap({ ...next, status: cur.status }),
    );
    return ok({ semesterId: id });
  });
}

export async function deleteSemester(
  adminId: number,
  id: number,
): Promise<Result<{ semesterId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const cur = await live(tx, id);
    if (!cur) return fail('NOT_FOUND', 'Semester not found.');
    await tx
      .update(semesters)
      .set({ deletedAt: new Date(), updatedBy: adminId, updatedAt: new Date() })
      .where(eq(semesters.id, id));
    await auditEntity(tx, adminId, 'DELETE', 'SEMESTER', id, snap(cur), null);
    return ok({ semesterId: id });
  });
}

/** Marks the semester done, so the series can start its next one. */
export async function completeSemester(
  adminId: number,
  id: number,
): Promise<Result<{ semesterId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const cur = await live(tx, id);
    if (!cur) return fail('NOT_FOUND', 'Semester not found.');
    if (cur.status === 'COMPLETED') return fail('BAD_REQUEST', 'Semester is already completed.');
    await tx
      .update(semesters)
      .set({ status: 'COMPLETED', updatedBy: adminId, updatedAt: new Date() })
      .where(eq(semesters.id, id));
    await auditEntity(
      tx,
      adminId,
      'UPDATE',
      'SEMESTER',
      id,
      snap(cur),
      snap({ ...cur, status: 'COMPLETED' }),
    );
    return ok({ semesterId: id });
  });
}

/** The same "they are all in week X now" for many semesters at once. */
export async function addCheckpoints(
  adminId: number,
  input: BulkCheckpointInput,
): Promise<Result<{ checkpointIds: number[] }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const ids = [...new Set(input.semesterIds)];
    const found = await fetchSemesters(tx, inArray(semesters.id, ids));
    if (found.length !== ids.length) return fail('NOT_FOUND', 'Some semesters were not found.');
    const bad = found.filter((s) => !s.template.some((p) => p.phase === input.phase));
    if (bad.length)
      return fail('UNPROCESSABLE', `${input.phase} is not part of semester ${bad[0]!.id}.`);

    const rows = await tx
      .insert(semesterCheckpoints)
      .values(
        ids.map((semesterId) => ({
          semesterId,
          asOfDate: input.asOfDate,
          phase: input.phase,
          weekIndex: input.weekIndex,
          note: input.note ?? null,
          createdBy: adminId,
        })),
      )
      .returning({ id: semesterCheckpoints.id, semesterId: semesterCheckpoints.semesterId });
    for (const r of rows) {
      await auditEntity(tx, adminId, 'CREATE', 'SEMESTER_CHECKPOINT', r.semesterId, null, {
        id: r.id,
        asOfDate: input.asOfDate,
        phase: input.phase,
        weekIndex: input.weekIndex,
      });
    }
    return ok({ checkpointIds: rows.map((r) => r.id) });
  });
}

export async function deleteCheckpoint(
  adminId: number,
  id: number,
): Promise<Result<{ checkpointId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const [row] = await tx.select().from(semesterCheckpoints).where(eq(semesterCheckpoints.id, id));
    if (!row) return fail('NOT_FOUND', 'Checkpoint not found.');
    await tx.delete(semesterCheckpoints).where(eq(semesterCheckpoints.id, id));
    await auditEntity(tx, adminId, 'DELETE', 'SEMESTER_CHECKPOINT', row.semesterId, row, null);
    return ok({ checkpointId: id });
  });
}

export async function setWeekOverride(
  adminId: number,
  semesterId: number,
  input: WeekOverrideInput,
): Promise<Result<{ semesterId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    if (!(await live(tx, semesterId))) return fail('NOT_FOUND', 'Semester not found.');
    const weekStart = weekStartOf(input.weekStart);
    const [prev] = await tx
      .select()
      .from(semesterWeekOverrides)
      .where(
        and(
          eq(semesterWeekOverrides.semesterId, semesterId),
          eq(semesterWeekOverrides.weekStart, weekStart),
        ),
      );
    const set = { mode: input.mode, note: input.note ?? null };
    await tx
      .insert(semesterWeekOverrides)
      .values({ semesterId, weekStart, ...set, updatedBy: adminId })
      .onConflictDoUpdate({
        target: [semesterWeekOverrides.semesterId, semesterWeekOverrides.weekStart],
        set: { ...set, updatedBy: adminId, updatedAt: new Date() },
      });
    await auditEntity(
      tx,
      adminId,
      prev ? 'UPDATE' : 'CREATE',
      'SEMESTER_WEEK_OVERRIDE',
      semesterId,
      prev ?? null,
      {
        weekStart,
        ...set,
      },
    );
    return ok({ semesterId });
  });
}

export async function clearWeekOverride(
  adminId: number,
  semesterId: number,
  weekStartInput: string,
): Promise<Result<{ semesterId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const weekStart = weekStartOf(weekStartInput);
    const [prev] = await tx
      .select()
      .from(semesterWeekOverrides)
      .where(
        and(
          eq(semesterWeekOverrides.semesterId, semesterId),
          eq(semesterWeekOverrides.weekStart, weekStart),
        ),
      );
    if (!prev) return fail('NOT_FOUND', 'No override for that week.');
    await tx
      .delete(semesterWeekOverrides)
      .where(
        and(
          eq(semesterWeekOverrides.semesterId, semesterId),
          eq(semesterWeekOverrides.weekStart, weekStart),
        ),
      );
    await auditEntity(tx, adminId, 'DELETE', 'SEMESTER_WEEK_OVERRIDE', semesterId, prev, null);
    return ok({ semesterId });
  });
}

export async function setPin(
  adminId: number,
  semesterId: number,
  input: PinInput,
): Promise<Result<{ semesterId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const cur = await live(tx, semesterId);
    if (!cur) return fail('NOT_FOUND', 'Semester not found.');
    if (!cur.template.some((p, i) => i > 0 && p.phase === input.phase)) {
      return fail('UNPROCESSABLE', `${input.phase} is not a later phase of this semester.`);
    }
    const [prev] = await tx
      .select()
      .from(semesterPins)
      .where(and(eq(semesterPins.semesterId, semesterId), eq(semesterPins.phase, input.phase)));
    const set = { startDate: input.startDate, note: input.note ?? null };
    await tx
      .insert(semesterPins)
      .values({ semesterId, phase: input.phase, ...set, updatedBy: adminId })
      .onConflictDoUpdate({
        target: [semesterPins.semesterId, semesterPins.phase],
        set: { ...set, updatedBy: adminId, updatedAt: new Date() },
      });
    await auditEntity(
      tx,
      adminId,
      prev ? 'UPDATE' : 'CREATE',
      'SEMESTER_PIN',
      semesterId,
      prev ?? null,
      {
        phase: input.phase,
        ...set,
      },
    );
    return ok({ semesterId });
  });
}

export async function clearPin(
  adminId: number,
  semesterId: number,
  phase: Phase,
): Promise<Result<{ semesterId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const [prev] = await tx
      .select()
      .from(semesterPins)
      .where(and(eq(semesterPins.semesterId, semesterId), eq(semesterPins.phase, phase)));
    if (!prev) return fail('NOT_FOUND', 'No pin for that phase.');
    await tx
      .delete(semesterPins)
      .where(and(eq(semesterPins.semesterId, semesterId), eq(semesterPins.phase, phase)));
    await auditEntity(tx, adminId, 'DELETE', 'SEMESTER_PIN', semesterId, prev, null);
    return ok({ semesterId });
  });
}
