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
  { phase: 'MID_BREAK', weeks: 1, extendable: false },
  { phase: 'CLASS', weeks: 6, extendable: true },
  { phase: 'VIVA', weeks: 1, extendable: true },
  { phase: 'EXAM', weeks: 4, extendable: true },
  { phase: 'SEMESTER_BREAK', weeks: 1, extendable: false },
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
      return { phase: b.phase, weekNo, block, extendable: b.extendable };
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
  /** Holiday (not a weekly off day) for THIS series on that date. */
  isOffDay: (date: string) => boolean;
  /** Holiday titles on a date; only used for the "why was it delayed" text. */
  titlesOn?: (date: string) => string[];
  /** JS weekdays (0 = Sunday) that are weekly off days. Default Thu, Fri. */
  weeklyOff?: number[];
  /** Stop after the week containing this date (default: run to graduation). */
  until?: string;
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
  skipReasons: string[];
  confirmed: boolean;
  /** Back-filled before the first admin position. */
  estimated: boolean;
}

export interface JourneySemester {
  semesterNo: number;
  label: string; // "২-২"
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

const BN = '০১২৩৪৫৬৭৮৯';
export const bnDigits = (s: string | number) => String(s).replace(/\d/g, (d) => BN[+d]!);
/** 1 -> "১-১", 4 -> "২-২", 8 -> "৪-২" */
export const semesterLabel = (n: number) => bnDigits(`${Math.ceil(n / 2)}-${n % 2 ? 1 : 2}`);

const MAX_WEEKS = 600;

export function computeJourney(input: JourneyInput): Journey {
  const { structure, isOffDay } = input;
  const weeklyOff = input.weeklyOff ?? [4, 5];
  const slots = buildSlots(structure);

  const working = (w: string) =>
    Array.from({ length: 7 }, (_, i) => addDays(w, i)).filter(
      (d) => !weeklyOff.includes(weekdayOf(d)),
    );
  const fullyOff = (w: string) => {
    const days = working(w);
    return days.length > 0 && days.every(isOffDay);
  };
  const reasons = (w: string) => [...new Set(working(w).flatMap((d) => input.titlesOn?.(d) ?? []))];

  // Positions the structure can place. A SEMESTER_START is always CLASS week 1.
  const placed = input.positions
    .map((p) => {
      const phase = p.kind === 'SEMESTER_START' ? 'CLASS' : p.phase;
      const weekNo = p.kind === 'SEMESTER_START' ? 1 : p.weekNo;
      const slot = slotIndex(slotsOf(slots, p.semesterNo), phase, weekNo);
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
  const mine = slotsOf(slots, anchor.semesterNo);
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
    const s = slotsOf(slots, sem)[k]!;

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
    if (++k >= slotsOf(slots, sem).length) {
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
  reason: string; // holiday titles joined with " ও "
  weeks: number;
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
  confirmed: boolean;
  nextMilestone: Milestone | null;
  /** First class day of the next semester (null in the last one). `confirmed` false = "~". */
  nextSemester: { semesterNo: number; date: string; confirmed: boolean } | null;
  /** Weeks pushed back from the current semester to graduation. */
  delayWeeks: number;
  delayReasons: DelayReason[];
}

/**
 * Skipped weeks from `fromWeek` on, grouped into runs of consecutive weeks (one vacation = one
 * entry) and named by the distinct holiday titles in the run, joined with " ও ".
 */
export function delayReasons(j: Journey, fromWeek: string): DelayReason[] {
  const groups: { last: string; titles: Set<string>; weeks: number }[] = [];
  for (const w of j.weeks) {
    if (w.status !== 'SKIPPED' || w.skipReasons.length === 0 || w.weekStart < fromWeek) continue;
    const g = groups[groups.length - 1];
    if (g && addDays(g.last, 7) === w.weekStart) {
      g.last = w.weekStart;
      g.weeks++;
      for (const t of w.skipReasons) g.titles.add(t);
    } else groups.push({ last: w.weekStart, titles: new Set(w.skipReasons), weeks: 1 });
  }
  return groups.map((g) => ({ reason: [...g.titles].join(' ও '), weeks: g.weeks }));
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
  const semStart = j.weeks.find((w) => w.semesterNo === now.semesterNo)!.weekStart;
  const reasons = delayReasons(j, semStart);
  return {
    status: 'RUNNING',
    semesterNo: now.semesterNo,
    semesterLabel: semesterLabel(now.semesterNo),
    phase: now.phase,
    weekNo: now.weekNo,
    phaseWeeks: Math.max(
      ...j.weeks
        .filter((w) => w.semesterNo === now.semesterNo && w.block === now.block)
        .map((w) => w.weekNo),
    ),
    onSkippedWeek: now.status === 'SKIPPED',
    confirmed: now.confirmed,
    nextMilestone,
    nextSemester: nextSem
      ? { semesterNo: nextSem.semesterNo, date: nextSem.weekStart, confirmed: nextSem.confirmed }
      : null,
    delayWeeks: reasons.reduce((n, r) => n + r.weeks, 0),
    delayReasons: reasons,
  };
}
