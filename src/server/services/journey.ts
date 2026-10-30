import 'server-only';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { coveredSeriesIds } from '@/core/calendar/compress';
import { parseOffDays, todayInDhaka } from '@/core/calendar/grid';
import { addDays } from '@/core/calendar/hijri';
import type { Structure } from '@/core/calendar/types';
import {
  applyChange,
  diffJourneys,
  groupImpacts,
  type ImpactGroup,
  type OffItem,
  type ProposedChange,
} from '@/core/journey/impact';
import {
  buildSlots,
  computeJourney,
  DEFAULT_STRUCTURE,
  stateOn,
  weekStartOf,
  type Journey,
  type JourneyStructure,
  type Position,
} from '@/core/journey/journey';
import { computeTasks, type Task } from '@/core/journey/tasks';
import { positionProblem, type BulkPositionsInput } from '@/core/validation/journey';
import { getDb, type Executor } from '@/server/db/client';
import { getStructure } from '@/server/db/queries';
import { academicSettings, seriesPositions } from '@/server/db/schema';
import { getOffDays } from './off-days';
import { listRules, ruleOccurrences } from './rules';
import { auditEntity, fail, lockWrites, ok, type Result } from './shared';

export interface PositionRecord extends Position {
  id: number;
  seriesId: number;
  note: string | null;
}

type DbStructure = Awaited<ReturnType<typeof getStructure>>;

const NO_JOURNEY: Journey = { weeks: [], semesters: [], graduation: null };

export function seriesLabel(structure: DbStructure, id: number) {
  const s = structure.series.find((x) => x.id === id);
  const d = s && structure.departments.find((x) => x.id === s.departmentId);
  return s && d ? `${d.code}-${String(s.intakeYear % 100).padStart(2, '0')}` : `#${id}`;
}

// ---------------------------------------------------------------------------------------
// Loading and computing
// ---------------------------------------------------------------------------------------

async function loadStructureSetting(x: Executor): Promise<JourneyStructure> {
  const [row] = await x.select().from(academicSettings).where(eq(academicSettings.id, 1));
  return row?.structure ?? DEFAULT_STRUCTURE;
}

async function loadPositions(x: Executor): Promise<PositionRecord[]> {
  const rows = await x
    .select()
    .from(seriesPositions)
    .where(isNull(seriesPositions.deletedAt))
    .orderBy(asc(seriesPositions.asOfDate), asc(seriesPositions.id));
  return rows.map((r) => ({
    id: r.id,
    seriesId: r.seriesId,
    asOfDate: r.asOfDate,
    semesterNo: r.semesterNo,
    phase: r.phase,
    weekNo: r.weekNo,
    kind: r.kind,
    note: r.note,
  }));
}

/** Wide enough for a back-fill before the first position and a full 8-semester projection. */
function offDayRange(positions: PositionRecord[], today: string) {
  const first = positions.reduce((m, p) => (p.asOfDate < m ? p.asOfDate : m), today);
  const last = positions.reduce((m, p) => (p.asOfDate > m ? p.asOfDate : m), today);
  return { from: addDays(first, -200), to: addDays(last, 2000) };
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

function journeysFor(
  positions: PositionRecord[],
  items: OffItem[],
  structure: DbStructure,
  settings: JourneyStructure,
): Map<number, Journey> {
  const bySeries = new Map<number, PositionRecord[]>();
  for (const p of positions) bySeries.set(p.seriesId, [...(bySeries.get(p.seriesId) ?? []), p]);
  const days = lookups(items, structure, [...bySeries.keys()]);
  const weeklyOff = parseOffDays(process.env.WEEKLY_OFF_DAYS);
  return new Map(
    [...bySeries].map(([seriesId, list]) => {
      const d = days.get(seriesId)!;
      const journey = computeJourney({
        positions: list,
        structure: settings,
        isOffDay: (x) => d.has(x),
        titlesOn: (x) => d.get(x) ?? [],
        weeklyOff,
      });
      return [seriesId, journey] as const;
    }),
  );
}

async function loadAll(x: Executor, change?: ProposedChange) {
  const [structure, settings, positions] = await Promise.all([
    getStructure(x),
    loadStructureSetting(x),
    loadPositions(x),
  ]);
  const base = await loadOffItems(x, offDayRange(positions, todayInDhaka()));
  const items = change ? applyChange(base, change) : base;
  return { structure, positions, journeys: journeysFor(positions, items, structure, settings) };
}

// ---------------------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------------------

/** One entry per active series, with its state on `date`. Series with no position are NONE. */
export async function statusOn(date: string = todayInDhaka()) {
  const { structure, journeys } = await loadAll(getDb());
  const series = structure.series.map((s) => ({
    seriesId: s.id,
    series: seriesLabel(structure, s.id),
    departmentId: s.departmentId,
    intakeYear: s.intakeYear,
    state: stateOn(journeys.get(s.id) ?? NO_JOURNEY, date),
  }));
  const summary: Record<string, number> = {};
  for (const x of series) {
    const k = x.state.phase ?? x.state.status;
    summary[k] = (summary[k] ?? 0) + 1;
  }
  return { date, summary, series };
}

/** Series whose journey has ended (state GRADUATED on `date`). Used by `npm run db:intake`. */
export async function graduatedSeries(date: string = todayInDhaka()) {
  const { structure, journeys } = await loadAll(getDb());
  return structure.series
    .filter((s) => stateOn(journeys.get(s.id) ?? NO_JOURNEY, date).status === 'GRADUATED')
    .map((s) => ({ id: s.id, label: seriesLabel(structure, s.id) }));
}

export async function seriesJourney(id: number, date: string = todayInDhaka()) {
  const { structure, journeys, positions } = await loadAll(getDb());
  const s = structure.series.find((x) => x.id === id);
  if (!s) return fail('NOT_FOUND', 'Series not found.');
  const j = journeys.get(id) ?? NO_JOURNEY;
  return ok({
    seriesId: id,
    series: seriesLabel(structure, id),
    intakeYear: s.intakeYear,
    state: stateOn(j, date),
    semesters: j.semesters,
    weeks: j.weeks,
    graduation: j.graduation,
    positions: positions.filter((p) => p.seriesId === id),
  });
}

// ---------------------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------------------

export async function listTasks(today: string = todayInDhaka()): Promise<{ tasks: Task[] }> {
  const db = getDb();
  const { structure, journeys } = await loadAll(db);
  const [rules, soon] = await Promise.all([
    listRules(Number(today.slice(0, 4))),
    ruleOccurrences(db, { from: today, to: addDays(today, 30) }),
  ]);
  return {
    tasks: computeTasks({
      today,
      series: structure.series.map((s) => ({
        seriesId: s.id,
        label: seriesLabel(structure, s.id),
        intakeYear: s.intakeYear,
        journey: journeys.get(s.id) ?? null,
      })),
      datesNeeded: rules.datesNeeded,
      tentative: soon
        .filter((o) => o.tentative)
        .map((o) => ({ ruleId: o.ruleId, year: o.year, title: o.title, startDate: o.startDate })),
    }),
  };
}

/** What a proposed holiday change does to the journeys (current and next semester + graduation). */
export async function computeImpact(change: ProposedChange): Promise<{ groups: ImpactGroup[] }> {
  const db = getDb();
  const [before, after] = await Promise.all([loadAll(db), loadAll(db, change)]);
  const today = todayInDhaka();
  const items = [...before.journeys].flatMap(([seriesId, j]) => {
    const st = stateOn(j, today);
    if (st.status !== 'RUNNING' || st.semesterNo === null) return [];
    const diff = diffJourneys(j, after.journeys.get(seriesId)!, st.semesterNo);
    return diff ? [{ seriesId, label: seriesLabel(before.structure, seriesId), diff }] : [];
  });
  return { groups: groupImpacts(items) };
}

export const getSettings = async () => ({ structure: await loadStructureSetting(getDb()) });

// ---------------------------------------------------------------------------------------
// Writes (lock, write, audit: one transaction)
// ---------------------------------------------------------------------------------------

interface PositionSnapshot {
  seriesId: number;
  asOfDate: string;
  semesterNo: number;
  phase: string;
  weekNo: number;
  kind: string;
  note: string | null;
}
const snap = (p: PositionSnapshot): PositionSnapshot => ({
  seriesId: p.seriesId,
  asOfDate: p.asOfDate,
  semesterNo: p.semesterNo,
  phase: p.phase,
  weekNo: p.weekNo,
  kind: p.kind,
  note: p.note,
});

/** The same position for many series. A series that already has one that week is replaced. */
export async function bulkPositions(
  adminId: number,
  input: BulkPositionsInput,
): Promise<Result<{ positionIds: number[] }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const structure = await getStructure(tx);
    const seriesIds = [...new Set(input.seriesIds)];
    const unknown = seriesIds.filter((id) => !structure.series.some((s) => s.id === id));
    if (unknown.length)
      return fail('UNPROCESSABLE', `Unknown or inactive series: ${unknown.join(', ')}.`);

    const start = input.kind === 'SEMESTER_START';
    const phase = start ? 'CLASS' : input.phase!;
    const weekNo = start ? 1 : input.weekNo!;
    const problem = positionProblem(await loadStructureSetting(tx), phase, weekNo);
    if (problem) return fail('UNPROCESSABLE', problem);

    const asOfDate = weekStartOf(input.asOfDate);
    const existing = await tx
      .select()
      .from(seriesPositions)
      .where(
        and(
          inArray(seriesPositions.seriesId, seriesIds),
          eq(seriesPositions.asOfDate, asOfDate),
          isNull(seriesPositions.deletedAt),
        ),
      );
    if (existing.length) {
      await tx
        .update(seriesPositions)
        .set({ deletedAt: new Date() })
        .where(
          inArray(
            seriesPositions.id,
            existing.map((e) => e.id),
          ),
        );
    }
    const note = input.note ?? null;
    const rows = await tx
      .insert(seriesPositions)
      .values(
        seriesIds.map((seriesId) => ({
          seriesId,
          asOfDate,
          semesterNo: input.semesterNo,
          phase,
          weekNo,
          kind: input.kind,
          note,
          createdBy: adminId,
        })),
      )
      .returning({ id: seriesPositions.id, seriesId: seriesPositions.seriesId });
    for (const r of rows) {
      const old = existing.find((e) => e.seriesId === r.seriesId);
      await auditEntity(
        tx,
        adminId,
        old ? 'UPDATE' : 'CREATE',
        'SERIES_POSITION',
        r.id,
        old ? snap(old) : null,
        snap({
          seriesId: r.seriesId,
          asOfDate,
          semesterNo: input.semesterNo,
          phase,
          weekNo,
          kind: input.kind,
          note,
        }),
      );
    }
    return ok({ positionIds: rows.map((r) => r.id) });
  });
}

export async function deletePosition(
  adminId: number,
  id: number,
): Promise<Result<{ positionId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const [row] = await tx
      .select()
      .from(seriesPositions)
      .where(and(eq(seriesPositions.id, id), isNull(seriesPositions.deletedAt)));
    if (!row) return fail('NOT_FOUND', 'Position not found.');
    await tx
      .update(seriesPositions)
      .set({ deletedAt: new Date() })
      .where(eq(seriesPositions.id, id));
    await auditEntity(tx, adminId, 'DELETE', 'SERIES_POSITION', id, snap(row), null);
    return ok({ positionId: id });
  });
}

/** Rare: change the shared semester structure. Refused if it would orphan a saved position. */
export async function putSettings(
  adminId: number,
  structure: JourneyStructure,
): Promise<Result<{ structure: JourneyStructure }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const slots = buildSlots(structure);
    const orphans = (await loadPositions(tx)).filter((p) => {
      const [phase, weekNo] =
        p.kind === 'SEMESTER_START' ? (['CLASS', 1] as const) : [p.phase, p.weekNo];
      return !slots.some((s) => s.phase === phase && s.weekNo === weekNo);
    });
    if (orphans.length) {
      const o = orphans[0]!;
      return fail(
        'UNPROCESSABLE',
        `${orphans.length} saved position(s) would no longer exist in this structure (e.g. ${o.phase} week ${o.weekNo}). Delete or change them first.`,
      );
    }
    const before = await loadStructureSetting(tx);
    await tx
      .insert(academicSettings)
      .values({ id: 1, structure, updatedBy: adminId })
      .onConflictDoUpdate({
        target: academicSettings.id,
        set: { structure, updatedBy: adminId, updatedAt: new Date() },
      });
    await auditEntity(
      tx,
      adminId,
      'UPDATE',
      'ACADEMIC_SETTINGS',
      1,
      { structure: before },
      { structure },
    );
    return ok({ structure });
  });
}
