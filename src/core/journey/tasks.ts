import { addDays } from '../calendar/hijri';
import { stateOn, type Journey } from './journey';

// Admin tasks (the admin to-do list): generated from the journeys, never stored. Pure.

export interface TaskSeries {
  seriesId: number;
  /** "CSE-23" */
  label: string;
  intakeYear: number;
  /** Null when the series has no position at all. */
  journey: Journey | null;
  /** Semesters whose mid-term break an admin already answered (confirmed or changed). */
  breakChecked?: number[];
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
      /** Overdue: the projected start date has already passed. */
      overdue: boolean;
      /** Date to pre-fill: the earliest projected start in the group. */
      projectedStart: string;
      /** Every series projects the same start date. */
      uniform: boolean;
      items: { seriesId: number; label: string; projectedStart: string }[];
    }
  | {
      type: 'MID_BREAK_CHECK';
      intakeYear: number;
      semesterNo: number;
      /** The Saturday the mid-term break is expected to start. */
      expectedStart: string;
      /** The break comes after this class week. */
      afterClassWeek: number;
      items: { seriesId: number; label: string }[];
    }
  | { type: 'NEW_BATCH'; intakeYear: number; seriesIds: number[]; labels: string[] }
  | { type: 'SET_STATUS'; seriesIds: number[]; labels: string[] }
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
    // on its own projection and nobody ever confirmed (the overdue case).
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

  // 1b. Mid-term break due within 14 days and nobody has answered yet. It goes away the day the
  // break starts; ignoring it is safe because the default keeps running.
  const breaks = new Map<string, Extract<Task, { type: 'MID_BREAK_CHECK' }>>();
  for (const s of input.series) {
    for (const sem of s.journey?.semesters ?? []) {
      const start = sem.midBreakStart;
      if (!start || s.breakChecked?.includes(sem.semesterNo)) continue;
      if (today >= start || addDays(today, 14) < start) continue;
      const classWeeks = s.journey!.weeks.filter(
        (w) =>
          w.semesterNo === sem.semesterNo &&
          w.phase === 'CLASS' &&
          w.status === 'COUNTED' &&
          w.weekStart < start,
      ).length;
      const key = `${s.intakeYear}:${sem.semesterNo}:${start}`;
      const g = breaks.get(key) ?? {
        type: 'MID_BREAK_CHECK' as const,
        intakeYear: s.intakeYear,
        semesterNo: sem.semesterNo,
        expectedStart: start,
        afterClassWeek: classWeeks,
        items: [],
      };
      g.items.push({ seriesId: s.seriesId, label: s.label });
      breaks.set(key, g);
    }
  }
  const breakChecks = [...breaks.values()].sort(
    (a, b) => a.expectedStart.localeCompare(b.expectedStart) || a.intakeYear - b.intakeYear,
  );

  // 2. Series with no position at all. Only a batch admitted this year (or later) can still be at
  // 1-1 day one; every older batch is already running, so it gets "set current status" and never a
  // date field that could reset it to 1-1.
  const year = Number(today.slice(0, 4));
  const fresh = new Map<number, TaskSeries[]>();
  const running: TaskSeries[] = [];
  for (const s of input.series) {
    if (s.journey && s.journey.weeks.length > 0) continue;
    if (s.intakeYear >= year) fresh.set(s.intakeYear, [...(fresh.get(s.intakeYear) ?? []), s]);
    else running.push(s);
  }
  const batches: Task[] = [...fresh.entries()]
    .sort(([a], [b]) => a - b)
    .map(([intakeYear, list]) => ({
      type: 'NEW_BATCH',
      intakeYear,
      seriesIds: list.map((s) => s.seriesId),
      labels: list.map((s) => s.label),
    }));
  const status: Task[] = running.length
    ? [
        {
          type: 'SET_STATUS',
          seriesIds: running.map((s) => s.seriesId),
          labels: running.map((s) => s.label),
        },
      ]
    : [];

  // 3. Dates for the coming year, from Nov 1 (and the current year if still missing).
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

  return [...starts, ...breakChecks, ...status, ...batches, ...yearly, ...moon];
}
