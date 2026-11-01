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
import {
  positionProblem,
  type BulkPositionsInput,
  type ScheduleInput,
} from '@/core/validation/journey';
import {
  fieldsFromStructure,
  scheduleProblem,
  structureFromFields,
  type ScheduleFields,
} from '@/core/journey/schedule';
import { getDb, type Executor } from '@/server/db/client';
import { getStructure } from '@/server/db/queries';
import { academicSettings, seriesPositions, seriesSemesterSchedule } from '@/server/db/schema';
import { getOffDays } from './off-days';
import { listRules, ruleOccurrences } from './rules';
import { auditEntity, fail, lockWrites, ok, type Result } from './shared';

export interface PositionRecord extends Position {
  id: number;
  seriesId: number;
  note: string | null;
}

type DbStructure = Awaited<ReturnType<typeof getStructure>>;

/** One series' semester that differs from the default, or whose mid-term break was answered. */
export interface ScheduleRecord {
  id: number;
  seriesId: number;
  semesterNo: number;
  structure: JourneyStructure | null;
  midBreakConfirmed: boolean;
}

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

async function loadSchedules(x: Executor): Promise<ScheduleRecord[]> {
  const rows = await x.select().from(seriesSemesterSchedule);
  return rows.map((r) => ({
    id: r.id,
    seriesId: r.seriesId,
    semesterNo: r.semesterNo,
    structure: r.structure,
    midBreakConfirmed: r.midBreakConfirmed,
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
  return days
    .filter((d) => d.category !== 'MID_BREAK' && d.category !== 'SEMESTER_BREAK')
    .map((d) => ({
    id: d.id,
    title: d.title,
    category: d.category,
    startDate: d.startDate,
    endDate: d.endDate,
    audience: d.audience,
  }));
}

/** Per series: date -> holiday titles that apply to that series. */
function lookups(items: OffItem[], structure: Structure, seriesIds: number[]) {
  const byDate = new Map(seriesIds.map((id) => [id, new Map<string, { title: string; category?: string }[]>()]));
  for (const h of items) {
    const covered = coveredSeriesIds(h.audience, structure);
    for (const id of seriesIds) {
      if (!covered.has(id)) continue;
      const days = byDate.get(id)!;
      for (let d = h.startDate; d <= h.endDate; d = addDays(d, 1)) {
        days.set(d, [...(days.get(d) ?? []), { title: h.title, category: h.category }]);
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
  schedules: ScheduleRecord[],
): Map<number, Journey> {
  const bySeries = new Map<number, PositionRecord[]>();
  for (const p of positions) bySeries.set(p.seriesId, [...(bySeries.get(p.seriesId) ?? []), p]);
  const days = lookups(items, structure, [...bySeries.keys()]);
  const weeklyOff = parseOffDays(process.env.WEEKLY_OFF_DAYS);
  return new Map(
    [...bySeries].map(([seriesId, list]) => {
      const d = days.get(seriesId)!;
      const own = new Map(
        schedules
          .filter((r) => r.seriesId === seriesId && r.structure)
          .map((r) => [r.semesterNo, r.structure!]),
      );
      const journey = computeJourney({
        positions: list,
        structure: settings,
        structureFor: (n) => own.get(n),
        isOffDay: (x) => d.has(x),
        titlesOn: (x) => (d.get(x) ?? []).map((i) => i.title),
        reasonsOn: (x) => d.get(x) ?? [],
        weeklyOff,
      });
      return [seriesId, journey] as const;
    }),
  );
}

async function loadAll(x: Executor, change?: ProposedChange) {
  const [structure, settings, positions, schedules] = await Promise.all([
    getStructure(x),
    loadStructureSetting(x),
    loadPositions(x),
    loadSchedules(x),
  ]);
  const base = await loadOffItems(x, offDayRange(positions, todayInDhaka()));
  const items = change ? applyChange(base, change) : base;
  return {
    structure,
    positions,
    schedules,
    settings,
    journeys: journeysFor(positions, items, structure, settings, schedules),
  };
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
  const { structure, journeys, positions, schedules, settings } = await loadAll(getDb());
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
    /** Semesters with their own schedule, or an answered mid-term break. */
    schedules: schedules
      .filter((r) => r.seriesId === id)
      .map((r) => ({
        semesterNo: r.semesterNo,
        fields: r.structure ? fieldsFromStructure(r.structure) : null,
        midBreakConfirmed: r.midBreakConfirmed,
      })),
    defaultFields: fieldsFromStructure(settings),
  });
}

export interface AcademicBreakItem {
  id: string;
  title: string;
  category: 'MID_BREAK' | 'SEMESTER_BREAK' | 'UNOFFICIAL_BREAK' | 'EXAM' | 'CLASS';
  startDate: string;
  endDate: string;
  seriesId: number;
  departmentId: number;
  series: string;
  deptCode: string;
  intakeYear: number;
  semesterNo: number;
  weekNo?: number;
  tentative: boolean;
}

/**
 * Computes all academic journey breaks (Mid-term break, Semester break, Unofficial break)
 * touching the date range [from, to] across all active series. Contiguous weeks of the same
 * break for a series are merged into a single date range.
 */
export async function academicBreaksInRange(
  from: string,
  to: string,
): Promise<AcademicBreakItem[]> {
  const { structure, journeys } = await loadAll(getDb());
  const rawBreaks: AcademicBreakItem[] = [];
  const deptMap = new Map(structure.departments.map((d) => [d.id, d.code]));

  for (const s of structure.series) {
    if (!s.isActive) continue;
    const j = journeys.get(s.id);
    if (!j) continue;
    const deptCode = deptMap.get(s.departmentId) ?? '';
    const series = seriesLabel(structure, s.id);

    for (const w of j.weeks) {
      if (w.status === 'COUNTED') {
        if (w.phase === 'MID_BREAK') {
          // Mid break strip: previous week Thursday to break week Friday
          const start = addDays(w.weekStart, -2);
          const end = addDays(w.weekStart, 6);
          if (end >= from && start <= to) {
            rawBreaks.push({
              id: `mid:${s.id}:${w.semesterNo}:${start}`,
              title: 'Mid-term break',
              category: 'MID_BREAK',
              startDate: start,
              endDate: end,
              seriesId: s.id,
              departmentId: s.departmentId,
              series,
              deptCode,
              intakeYear: s.intakeYear,
              semesterNo: w.semesterNo,
              tentative: !w.confirmed,
            });
          }
        } else if (w.phase === 'SEMESTER_BREAK') {
          // Semester break strip: from the day after E5 to Friday of that week
          const lastExamWeek = [...j.weeks]
            .reverse()
            .find(
              (ew) =>
                ew.semesterNo === w.semesterNo &&
                ew.phase === 'EXAM' &&
                ew.status === 'COUNTED',
            );
          const e5Date = lastExamWeek
            ? addDays(lastExamWeek.weekStart, Math.max(0, 5 - lastExamWeek.weekNo))
            : addDays(w.weekStart, -1);
          const start = addDays(e5Date, 1);
          const examWeekFriday = addDays(weekStartOf(e5Date), 6);
          const end = start <= examWeekFriday ? examWeekFriday : addDays(weekStartOf(start), 6);
          if (end >= from && start <= to) {
            rawBreaks.push({
              id: `sem:${s.id}:${w.semesterNo}:${start}`,
              title: 'Semester break',
              category: 'SEMESTER_BREAK',
              startDate: start,
              endDate: end,
              seriesId: s.id,
              departmentId: s.departmentId,
              series,
              deptCode,
              intakeYear: s.intakeYear,
              semesterNo: w.semesterNo,
              tentative: !w.confirmed,
            });
          }
        } else if (w.phase === 'EXAM') {
          // Exam date: E1 Wed (+4), E2 Tue (+3), E3 Mon (+2), E4 Sun (+1), E5 Sat (+0)
          const examDate = addDays(w.weekStart, Math.max(0, 5 - w.weekNo));
          if (examDate >= from && examDate <= to) {
            rawBreaks.push({
              id: `exam:${s.id}:${w.semesterNo}:${w.weekNo}:${examDate}`,
              title: `Semester Final (E${w.weekNo})`,
              category: 'EXAM',
              startDate: examDate,
              endDate: examDate,
              seriesId: s.id,
              departmentId: s.departmentId,
              series,
              deptCode,
              intakeYear: s.intakeYear,
              semesterNo: w.semesterNo,
              weekNo: w.weekNo,
              tentative: !w.confirmed,
            });
          }
        } else if (w.phase === 'CLASS') {
          // Class week: Saturday to Wednesday
          const start = w.weekStart;
          const end = addDays(w.weekStart, 4);
          if (end >= from && start <= to) {
            rawBreaks.push({
              id: `class:${s.id}:${w.semesterNo}:${w.weekNo}:${start}`,
              title: `Class week ${w.weekNo}`,
              category: 'CLASS',
              startDate: start,
              endDate: end,
              seriesId: s.id,
              departmentId: s.departmentId,
              series,
              deptCode,
              intakeYear: s.intakeYear,
              semesterNo: w.semesterNo,
              weekNo: w.weekNo,
              tentative: !w.confirmed,
            });
          }
        }
      } else if (w.status === 'SKIPPED') {
        const isUnofficial = w.skipReasons.some(
          (r) =>
            r.category === 'UNOFFICIAL_BREAK' ||
            r.category === 'SUSPENDED_WEEK' ||
            /unofficial|auto|suspend/i.test(r.title),
        );
        if (isUnofficial) {
          // Unofficial break strip: previous week Thursday to break week Friday
          const start = addDays(w.weekStart, -2);
          const end = addDays(w.weekStart, 6);
          if (end >= from && start <= to) {
            const reasonTitle =
              w.skipReasons.map((r) => r.title).join(', ') || 'Unofficial break';
            rawBreaks.push({
              id: `unoff:${s.id}:${w.semesterNo}:${start}`,
              title: reasonTitle,
              category: 'UNOFFICIAL_BREAK',
              startDate: start,
              endDate: end,
              seriesId: s.id,
              departmentId: s.departmentId,
              series,
              deptCode,
              intakeYear: s.intakeYear,
              semesterNo: w.semesterNo,
              tentative: false,
            });
          }
        }
      }
    }
  }

  // Combine contiguous / overlapping weeks for the same series and break type
  rawBreaks.sort((a, b) => a.seriesId - b.seriesId || a.startDate.localeCompare(b.startDate));
  const merged: AcademicBreakItem[] = [];
  for (const b of rawBreaks) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.seriesId === b.seriesId &&
      prev.category === b.category &&
      prev.semesterNo === b.semesterNo &&
      (b.category === 'MID_BREAK' || b.category === 'UNOFFICIAL_BREAK' || b.category === 'SEMESTER_BREAK') &&
      b.startDate <= addDays(prev.endDate, 2)
    ) {
      if (b.endDate > prev.endDate) {
        prev.endDate = b.endDate;
      }
    } else {
      merged.push({ ...b });
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------------------

export async function listTasks(today: string = todayInDhaka()): Promise<{ tasks: Task[] }> {
  const db = getDb();
  const { structure, journeys, schedules } = await loadAll(db);
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
        breakChecked: schedules
          .filter((r) => r.seriesId === s.id && (r.midBreakConfirmed || r.structure))
          .map((r) => r.semesterNo),
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
    const setting = await loadStructureSetting(tx);
    const schedules = await loadSchedules(tx);
    const problem = seriesIds.reduce<string | null>((err, id) => {
      if (err) return err;
      const own = schedules.find(
        (r) => r.seriesId === id && r.semesterNo === input.semesterNo,
      )?.structure;
      const base = own ?? setting;
      const eff =
        phase === 'EXAM' && weekNo === 5
          ? base.map((b) => (b.phase === 'EXAM' && b.weeks < 5 ? { ...b, weeks: 5 } : b))
          : base;
      return positionProblem(eff, phase, weekNo);
    }, null);
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

// ---------------------------------------------------------------------------------------
// Per-semester schedule (Phase 14 §2)
// ---------------------------------------------------------------------------------------

/**
 * Give some series a different schedule for ONE semester, or just confirm the default ("Yes,
 * that's right" on the mid-term break card). Either way the break counts as answered. Refused if a
 * saved position of that semester would no longer exist in the new schedule.
 */
export async function setSchedule(
  adminId: number,
  input: ScheduleInput,
): Promise<Result<{ updated: number }>> {
  const fields: ScheduleFields | undefined = input.fields;
  if (fields) {
    const problem = scheduleProblem(fields);
    if (problem) return fail('UNPROCESSABLE', problem);
  }
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const structure = await getStructure(tx);
    const seriesIds = [...new Set(input.seriesIds)];
    const unknown = seriesIds.filter((id) => !structure.series.some((s) => s.id === id));
    if (unknown.length) {
      return fail('UNPROCESSABLE', `Unknown or inactive series: ${unknown.join(', ')}.`);
    }

    const defaults = await loadStructureSetting(tx);
    // Equal to the default means "no override": stored as NULL so a later default change applies.
    const same = fields && JSON.stringify(structureFromFields(fields)) === JSON.stringify(defaults);
    const next = fields && !same ? structureFromFields(fields) : null;

    if (next) {
      const slots = buildSlots(next);
      const orphan = (await loadPositions(tx)).find((p) => {
        if (!seriesIds.includes(p.seriesId) || p.semesterNo !== input.semesterNo) return false;
        const [phase, weekNo] =
          p.kind === 'SEMESTER_START' ? (['CLASS', 1] as const) : [p.phase, p.weekNo];
        return !slots.some((s) => s.phase === phase && s.weekNo === weekNo);
      });
      if (orphan) {
        return fail(
          'UNPROCESSABLE',
          `${seriesLabel(structure, orphan.seriesId)} has a saved ${orphan.phase} week ${orphan.weekNo} that this schedule does not have. Delete or change it first.`,
        );
      }
    }

    const existing = await tx
      .select()
      .from(seriesSemesterSchedule)
      .where(
        and(
          inArray(seriesSemesterSchedule.seriesId, seriesIds),
          eq(seriesSemesterSchedule.semesterNo, input.semesterNo),
        ),
      );
    for (const seriesId of seriesIds) {
      const old = existing.find((e) => e.seriesId === seriesId);
      // Without new numbers an existing custom schedule is kept; only the confirmation is added.
      const structureValue = fields ? next : (old?.structure ?? null);
      const [row] = await tx
        .insert(seriesSemesterSchedule)
        .values({
          seriesId,
          semesterNo: input.semesterNo,
          structure: structureValue,
          midBreakConfirmed: true,
          note: input.note ?? null,
          createdBy: adminId,
        })
        .onConflictDoUpdate({
          target: [seriesSemesterSchedule.seriesId, seriesSemesterSchedule.semesterNo],
          set: {
            structure: structureValue,
            midBreakConfirmed: true,
            note: input.note ?? old?.note ?? null,
            updatedAt: new Date(),
          },
        })
        .returning({ id: seriesSemesterSchedule.id });
      const snap = (st: JourneyStructure | null, confirmed: boolean) => ({
        seriesId,
        semesterNo: input.semesterNo,
        fields: st ? fieldsFromStructure(st) : null,
        midBreakConfirmed: confirmed,
      });
      await auditEntity(
        tx,
        adminId,
        old ? 'UPDATE' : 'CREATE',
        'SERIES_SCHEDULE',
        row!.id,
        old ? snap(old.structure, old.midBreakConfirmed) : null,
        snap(structureValue, true),
      );
    }
    return ok({ updated: seriesIds.length });
  });
}
