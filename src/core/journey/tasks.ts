import { addDays } from '../calendar/hijri';
import { stateOn, type Journey } from './journey';

// Admin tasks ("করণীয়", spec §5): generated from the journeys, never stored. Pure.

export interface TaskSeries {
  seriesId: number;
  /** "CSE-23" */
  label: string;
  intakeYear: number;
  /** Null when the series has no position at all. */
  journey: Journey | null;
}

export interface TaskInput {
  today: string;
  series: TaskSeries[];
  /** MANUAL_YEARLY rules without dates, per year (from the rules service). */
  datesNeeded: { year: number; rules: { id: number; title: string }[] }[];
  /** Tentative (Hijri) occurrences, any date; filtered to the next 30 days here. */
  tentative: { ruleId: number; year: number; title: string; startDate: string }[];
}

export type Task =
  | {
      type: 'NEXT_SEMESTER_START';
      intakeYear: number;
      semesterNo: number;
      /** Red "বাকি": the projected start date has already passed. */
      overdue: boolean;
      /** Date to pre-fill: the earliest projected start in the group. */
      projectedStart: string;
      /** Every series projects the same start date ("সবার জন্য একই"). */
      uniform: boolean;
      items: { seriesId: number; label: string; projectedStart: string }[];
    }
  | { type: 'NEW_BATCH'; intakeYear: number; seriesIds: number[]; labels: string[] }
  | { type: 'YEARLY_DATES'; year: number; rules: { id: number; title: string }[] }
  | { type: 'CONFIRM_MOON'; items: TaskInput['tentative'] };

export function computeTasks(input: TaskInput): Task[] {
  const { today } = input;

  // 1. Next semester start date, grouped by (intake year, semester).
  const groups = new Map<string, Extract<Task, { type: 'NEXT_SEMESTER_START' }>>();
  for (const s of input.series) {
    if (!s.journey) continue;
    const st = stateOn(s.journey, today);
    if (st.status !== 'RUNNING' || st.semesterNo === null) continue;
    const cur = s.journey.semesters.find((x) => x.semesterNo === st.semesterNo)!;
    const nearEnd = st.phase === 'SEMESTER_BREAK' || (st.phase === 'EXAM' && (st.weekNo ?? 0) >= 3);
    // Near the end: the next semester needs a date. Otherwise only a semester that started
    // on its own projection and nobody ever confirmed (the red "বাকি" case).
    const target = nearEnd ? st.semesterNo + 1 : cur.confirmed ? null : st.semesterNo;
    if (target === null || target > 8) continue;
    const sem = s.journey.semesters.find((x) => x.semesterNo === target);
    if (!sem?.classStart || sem.confirmed) continue;

    const key = `${s.intakeYear}:${target}`;
    const g = groups.get(key) ?? {
      type: 'NEXT_SEMESTER_START' as const,
      intakeYear: s.intakeYear,
      semesterNo: target,
      overdue: false,
      projectedStart: sem.classStart,
      uniform: true,
      items: [],
    };
    g.items.push({ seriesId: s.seriesId, label: s.label, projectedStart: sem.classStart });
    if (sem.classStart < g.projectedStart) g.projectedStart = sem.classStart;
    groups.set(key, g);
  }
  const starts = [...groups.values()].map((g) => ({
    ...g,
    uniform: g.items.every((i) => i.projectedStart === g.items[0]!.projectedStart),
    overdue: g.projectedStart < today,
  }));
  starts.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      a.projectedStart.localeCompare(b.projectedStart) ||
      a.intakeYear - b.intakeYear,
  );

  // 2. New batch: series that have no position at all.
  const fresh = new Map<number, TaskSeries[]>();
  for (const s of input.series) {
    if (s.journey && s.journey.weeks.length > 0) continue;
    fresh.set(s.intakeYear, [...(fresh.get(s.intakeYear) ?? []), s]);
  }
  const batches: Task[] = [...fresh.entries()]
    .sort(([a], [b]) => a - b)
    .map(([intakeYear, list]) => ({
      type: 'NEW_BATCH',
      intakeYear,
      seriesIds: list.map((s) => s.seriesId),
      labels: list.map((s) => s.label),
    }));

  // 3. Dates for the coming year, from Nov 1 (and the current year if still missing).
  const year = Number(today.slice(0, 4));
  const yearly: Task[] =
    Number(today.slice(5, 7)) >= 11
      ? input.datesNeeded
          .filter((d) => d.rules.length > 0 && d.year >= year && d.year <= year + 1)
          .sort((a, b) => a.year - b.year)
          .map((d) => ({ type: 'YEARLY_DATES', year: d.year, rules: d.rules }))
      : [];

  // 4. Moon sighting for tentative days starting within 30 days (optional, lowest priority).
  const soon = input.tentative
    .filter((t) => t.startDate >= today && t.startDate <= addDays(today, 30))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const moon: Task[] = soon.length ? [{ type: 'CONFIRM_MOON', items: soon }] : [];

  return [...starts, ...batches, ...yearly, ...moon];
}
