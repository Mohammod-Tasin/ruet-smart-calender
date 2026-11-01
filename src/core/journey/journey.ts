import { addDays, weekdayOf } from '../calendar/hijri';

// Series journey (CLAUDE.md §15, docs/phase-12-journey-spec.md §1-4). Pure: no DB, no Next.js.
// The journey is always derived from the inputs below and never stored.

export type JPhase = 'CLASS' | 'MID_BREAK' | 'VIVA' | 'EXAM' | 'SEMESTER_BREAK';
export const J_PHASES: JPhase[] = ['CLASS', 'MID_BREAK', 'VIVA', 'EXAM', 'SEMESTER_BREAK'];

export interface StructureBlock {
  phase: JPhase;
  weeks: number;
  /** A fully-off week in this block is not counted and pushes the rest back. */
  extendable: boolean;
}
export type JourneyStructure = StructureBlock[];

export const DEFAULT_STRUCTURE: JourneyStructure = [
  { phase: 'CLASS', weeks: 7, extendable: true },
  { phase: 'MID_BREAK', weeks: 1, extendable: true },
  { phase: 'CLASS', weeks: 6, extendable: true },
  { phase: 'VIVA', weeks: 1, extendable: true },
  { phase: 'EXAM', weeks: 4, extendable: true },
  { phase: 'SEMESTER_BREAK', weeks: 1, extendable: true },
];

export const SEMESTERS = 8; // 1-1 ... 4-2

/** One week of one semester: CLASS 1..13, EXAM 1..4, the others 1. */
export interface Slot {
  phase: JPhase;
  weekNo: number;
  block: number;
  extendable: boolean;
}

export function buildSlots(structure: JourneyStructure): Slot[] {
  const seen: Partial<Record<JPhase, number>> = {};
  return structure.flatMap((b, block) =>
    Array.from({ length: b.weeks }, () => {
      const weekNo = (seen[b.phase] = (seen[b.phase] ?? 0) + 1);
      const extendable =
        b.phase === 'MID_BREAK' || b.phase === 'SEMESTER_BREAK' ? true : (b.extendable ?? true);
      return { phase: b.phase, weekNo, block, extendable };
    }),
  );
}

/** The last semester has no break after it: the series graduates. */
const slotsOf = (slots: Slot[], sem: number) => {
  if (sem < SEMESTERS) return slots;
  let n = slots.length;
  while (n > 0 && slots[n - 1]!.phase === 'SEMESTER_BREAK') n--;
  return slots.slice(0, n);
};

/** Index of "phase, week" in a semester, or -1 when the structure has no such week. */
export const slotIndex = (slots: Slot[], phase: JPhase, weekNo: number) =>
  slots.findIndex((s) => s.phase === phase && s.weekNo === weekNo);

/** The Saturday on or before `date` (weeks run Saturday to Friday). */
export const weekStartOf = (date: string) => addDays(date, -((weekdayOf(date) + 1) % 7));

export interface Position {
  asOfDate: string; // normalised to a Saturday by the DB layer; re-normalised here
  semesterNo: number;
  phase: JPhase;
  weekNo: number;
  kind: 'POSITION' | 'SEMESTER_START';
}

export interface JourneyInput {
  positions: Position[];
  structure: JourneyStructure;
  /** A semester whose schedule differs from `structure` (Phase 14). Default: `structure`. */
  structureFor?: (semesterNo: number) => JourneyStructure | undefined;
  /** Holiday (not a weekly off day) for THIS series on that date. */
  isOffDay: (date: string) => boolean;
  /** Holiday titles on a date; only used for the "why was it delayed" text. */
  titlesOn?: (date: string) => string[];
  reasonsOn?: (date: string) => { title: string; category?: string }[];
  /** JS weekdays (0 = Sunday) that are weekly off days. Default Thu, Fri. */
  weeklyOff?: number[];
  /** Stop after the week containing this date (default: run to graduation). */
  until?: string;
}

/** One holiday inside one skipped week: its title and the working days of that week it covers. */
export interface SkipReason {
  title: string;
  category?: string;
  start: string;
  end: string;
  days: number;
}

export interface JourneyWeek {
  weekStart: string; // a Saturday
  semesterNo: number;
  phase: JPhase;
  /** Index of the structure block (tells apart the two CLASS blocks). */
  block: number;
  /** For a SKIPPED week: the week that is waiting to be counted. */
  weekNo: number;
  status: 'COUNTED' | 'SKIPPED';
  /** Holidays that made this week a skipped one, the one covering most working days first. */
  skipReasons: SkipReason[];
  confirmed: boolean;
  /** Back-filled before the first admin position. */
  estimated: boolean;
}

export interface JourneySemester {
  semesterNo: number;
  label: string; // "2-2"
  classStart: string | null;
  midBreakStart: string | null;
  vivaStart: string | null;
  examStart: string | null;
  breakStart: string | null;
  /** Last day (Friday) of the last week; null when the journey was cut short. */
  end: string | null;
  confirmed: boolean;
  /** classStart was worked out backwards, not entered. */
  startEstimated: boolean;
}

export interface Journey {
  weeks: JourneyWeek[];
  semesters: JourneySemester[];
  /** The Saturday after the last 4-2 exam week; null if there is no journey or it was cut short. */
  graduation: string | null;
}

/** 1 -> "1-1", 4 -> "2-2", 8 -> "4-2" */
export const semesterLabel = (n: number) => `${Math.ceil(n / 2)}-${n % 2 ? 1 : 2}`;

const MAX_WEEKS = 600;

export function computeJourney(input: JourneyInput): Journey {
  const { structure, isOffDay } = input;
  const weeklyOff = input.weeklyOff ?? [4, 5];
  const slotCache = new Map<number, Slot[]>();
  /** The slots of one semester: its own schedule if it has one, else the default. */
  const semSlots = (sem: number) => {
    let s = slotCache.get(sem);
    if (!s) {
      s = slotsOf(buildSlots(input.structureFor?.(sem) ?? structure), sem);
      slotCache.set(sem, s);
    }
    return s;
  };

  const working = (w: string) =>
    Array.from({ length: 7 }, (_, i) => addDays(w, i)).filter(
      (d) => !weeklyOff.includes(weekdayOf(d)),
    );
  const fullyOff = (w: string) => {
    const days = working(w);
    return days.length > 0 && days.every(isOffDay);
  };
  const reasons = (w: string): SkipReason[] => {
    const byTitle = new Map<string, SkipReason>();
    for (const d of working(w)) {
      const items: { title: string; category?: string }[] = input.reasonsOn ? input.reasonsOn(d) : (input.titlesOn?.(d) ?? []).map((t) => ({ title: t }));
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item.title)) continue;
        seen.add(item.title);
        const r = byTitle.get(item.title);
        if (r) Object.assign(r, { end: d, days: r.days + 1 });
        else byTitle.set(item.title, { title: item.title, category: item.category, start: d, end: d, days: 1 });
      }
    }
    return [...byTitle.values()].sort((a, b) => b.days - a.days);
  };

  // Positions the structure can place. A SEMESTER_START is always CLASS week 1.
  const placed = input.positions
    .map((p) => {
      const phase = p.kind === 'SEMESTER_START' ? 'CLASS' : p.phase;
      const weekNo = p.kind === 'SEMESTER_START' ? 1 : p.weekNo;
      const slot = slotIndex(semSlots(p.semesterNo), phase, weekNo);
      return { ...p, week: weekStartOf(p.asOfDate), slot };
    })
    .filter((p) => p.slot >= 0 && p.semesterNo >= 1 && p.semesterNo <= SEMESTERS)
    .sort((a, b) => a.week.localeCompare(b.week));
  if (placed.length === 0) return { weeks: [], semesters: [], graduation: null };

  const byWeek = new Map(placed.map((p) => [p.week, p])); // admin data wins, one per week
  const anchor = placed[0]!;

  const row = (
    weekStart: string,
    semesterNo: number,
    s: Slot,
    status: JourneyWeek['status'],
    extra: Partial<JourneyWeek> = {},
  ): JourneyWeek => ({
    weekStart,
    semesterNo,
    phase: s.phase,
    block: s.block,
    weekNo: s.weekNo,
    status,
    skipReasons: [],
    confirmed: false,
    estimated: false,
    ...extra,
  });

  // 1. Back-fill the anchor's semester: walk backwards with the same skip rules.
  const back: JourneyWeek[] = [];
  const mine = semSlots(anchor.semesterNo);
  let w = anchor.week;
  for (let j = anchor.slot - 1; j >= 0 && back.length < MAX_WEEKS; j--) {
    w = addDays(w, -7);
    // Weeks that were skipped while slot j+1 was waiting sit between j and j+1.
    while (mine[j + 1]!.extendable && fullyOff(w) && back.length < MAX_WEEKS) {
      back.push(
        row(w, anchor.semesterNo, mine[j + 1]!, 'SKIPPED', {
          skipReasons: reasons(w),
          estimated: true,
        }),
      );
      w = addDays(w, -7);
    }
    back.push(row(w, anchor.semesterNo, mine[j]!, 'COUNTED', { estimated: true }));
  }
  const weeks = back.reverse();

  // 2. Walk forward to graduation (or `until`). The first semester that is waiting for a
  // confirmed start date does not run ahead of it.
  let sem = anchor.semesterNo;
  let k = anchor.slot;
  let graduation: string | null = null;
  for (let week = anchor.week; weeks.length < MAX_WEEKS; week = addDays(week, 7)) {
    if (input.until && week > input.until) break;
    const p = byWeek.get(week);
    if (p) ({ semesterNo: sem, slot: k } = p);
    const s = semSlots(sem)[k]!;

    const waitingForStart =
      !p &&
      k === 0 &&
      placed.some((q) => q.kind === 'SEMESTER_START' && q.semesterNo === sem && q.week > week);
    if (waitingForStart || (!p && s.extendable && fullyOff(week))) {
      weeks.push(
        row(week, sem, s, 'SKIPPED', { skipReasons: waitingForStart ? [] : reasons(week) }),
      );
      continue;
    }
    weeks.push(row(week, sem, s, 'COUNTED'));
    if (++k >= semSlots(sem).length) {
      if (sem >= SEMESTERS) {
        graduation = addDays(week, 7);
        break;
      }
      sem++;
      k = 0;
    }
  }

  // 3. Confirmed = from the first admin position of a semester to the end of that semester.
  const anchorOf = new Map<number, string>();
  for (const p of placed) if (!anchorOf.has(p.semesterNo)) anchorOf.set(p.semesterNo, p.week);
  for (const x of weeks) {
    const from = anchorOf.get(x.semesterNo);
    x.confirmed = from !== undefined && x.weekStart >= from;
  }

  return { weeks, semesters: summarise(weeks, anchorOf, graduation !== null), graduation };
}

function summarise(
  weeks: JourneyWeek[],
  anchorOf: Map<number, string>,
  graduated: boolean,
): JourneySemester[] {
  const nos = [...new Set(weeks.map((w) => w.semesterNo))].sort((a, b) => a - b);
  return nos.map((semesterNo) => {
    const mine = weeks.filter((w) => w.semesterNo === semesterNo);
    const counted = mine.filter((w) => w.status === 'COUNTED');
    const start = (phase: JPhase) => counted.find((w) => w.phase === phase)?.weekStart ?? null;
    const last = mine[mine.length - 1]!;
    // Finished once the walk moved on to a later semester (or graduated after 4-2).
    const done =
      weeks.some((w) => w.semesterNo > semesterNo) || (graduated && semesterNo === SEMESTERS);
    return {
      semesterNo,
      label: semesterLabel(semesterNo),
      classStart: start('CLASS'),
      midBreakStart: start('MID_BREAK'),
      vivaStart: start('VIVA'),
      examStart: start('EXAM'),
      breakStart: start('SEMESTER_BREAK'),
      end: done ? addDays(last.weekStart, 6) : null,
      confirmed: anchorOf.has(semesterNo),
      startEstimated: counted[0]?.estimated ?? false,
    };
  });
}

// --- State on a date ---------------------------------------------------------------------------

export interface Milestone {
  /** Semester whose phase starts; null for graduation. */
  semesterNo: number | null;
  phase: JPhase | 'GRADUATION';
  date: string;
  confirmed: boolean;
}

export interface DelayReason {
  reason: string; // one holiday title
  weeks: number;
  /** First and last day (of the skipped weeks) the holiday covers. */
  start: string;
  end: string;
}

export interface JourneyState {
  status: 'NONE' | 'BEFORE' | 'RUNNING' | 'GRADUATED';
  semesterNo: number | null;
  semesterLabel: string | null;
  phase: JPhase | null;
  weekNo: number | null;
  /** Length in weeks of the current phase block (from the stored structure). */
  phaseWeeks: number | null;
  /** This very week is a skipped (holiday) week. */
  onSkippedWeek: boolean;
  /** True when the current skipped week is an unofficial break (Auto) or suspension. */
  onUnofficialBreak?: boolean;
  confirmed: boolean;
  nextMilestone: Milestone | null;
  /** First class day of the next semester (null in the last one). `confirmed` false = "~". */
  nextSemester: { semesterNo: number; date: string; confirmed: boolean } | null;
  /** Weeks this semester has slipped so far (skipped weeks up to the selected date). */
  delayWeeks: number;
  delayReasons: DelayReason[];
}

/**
 * Why the current semester slipped: skipped weeks of `semesterNo` that have started by `date`,
 * one entry per holiday (the one covering most of each skipped week). Never future weeks.
 */
export function delayReasons(j: Journey, semesterNo: number, date: string): DelayReason[] {
  const byTitle = new Map<string, DelayReason>();
  for (const w of j.weeks) {
    const top = w.skipReasons[0];
    if (w.status !== 'SKIPPED' || !top || w.semesterNo !== semesterNo || w.weekStart > date)
      continue;
    const r = byTitle.get(top.title);
    if (!r) byTitle.set(top.title, { reason: top.title, weeks: 1, start: top.start, end: top.end });
    else {
      r.weeks++;
      if (top.start < r.start) r.start = top.start;
      if (top.end > r.end) r.end = top.end;
    }
  }
  return [...byTitle.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export function stateOn(j: Journey, date: string): JourneyState {
  const empty: JourneyState = {
    status: 'NONE',
    semesterNo: null,
    semesterLabel: null,
    phase: null,
    weekNo: null,
    phaseWeeks: null,
    onSkippedWeek: false,
    confirmed: false,
    nextMilestone: null,
    nextSemester: null,
    delayWeeks: 0,
    delayReasons: [],
  };
  const first = j.weeks[0];
  if (!first) return empty;
  if (date < first.weekStart) return { ...empty, status: 'BEFORE' };
  const i = j.weeks.findIndex((w) => date >= w.weekStart && date < addDays(w.weekStart, 7));
  if (i < 0) {
    return j.graduation && date >= j.graduation ? { ...empty, status: 'GRADUATED' } : empty;
  }
  const now = j.weeks[i]!;

  const next = j.weeks
    .slice(i + 1)
    .find(
      (w) => w.status === 'COUNTED' && (w.phase !== now.phase || w.semesterNo !== now.semesterNo),
    );
  const nextMilestone: Milestone | null = next
    ? {
      semesterNo: next.semesterNo,
      phase: next.phase,
      date: next.weekStart,
      confirmed: next.confirmed,
    }
    : j.graduation
      ? { semesterNo: null, phase: 'GRADUATION', date: j.graduation, confirmed: false }
      : null;

  const nextSem = j.weeks
    .slice(i + 1)
    .find((w) => w.status === 'COUNTED' && w.semesterNo > now.semesterNo);
  const reasons = delayReasons(j, now.semesterNo, date);
  return {
    status: 'RUNNING',
    semesterNo: now.semesterNo,
    semesterLabel: semesterLabel(now.semesterNo),
    phase: now.phase,
    weekNo: now.weekNo,
    phaseWeeks: Math.max(
      ...j.weeks
        .filter((w) => w.semesterNo === now.semesterNo && w.phase === now.phase)
        .map((w) => w.weekNo),
    ),
    onSkippedWeek: now.status === 'SKIPPED',
    onUnofficialBreak:
      now.status === 'SKIPPED' &&
      now.skipReasons.some(
        (r) =>
          r.category === 'UNOFFICIAL_BREAK' ||
          r.category === 'SUSPENDED_WEEK' ||
          /unofficial|auto|suspend/i.test(r.title),
      ),
    confirmed: now.confirmed,
    nextMilestone,
    nextSemester: nextSem
      ? { semesterNo: nextSem.semesterNo, date: nextSem.weekStart, confirmed: nextSem.confirmed }
      : null,
    delayWeeks: reasons.reduce((n, r) => n + r.weeks, 0),
    delayReasons: reasons,
  };
}
