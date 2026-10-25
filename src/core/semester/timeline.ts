import { addDays, weekdayOf } from '../calendar/hijri';

// Semester timeline (CLAUDE.md §15, spec §4). Pure: no DB, no Next.js. The timeline is always
// derived from the inputs below and never stored.

export type Phase = 'CLASS' | 'MID_BREAK' | 'VIVA' | 'FINALS';
export const PHASES: Phase[] = ['CLASS', 'MID_BREAK', 'VIVA', 'FINALS'];

export interface TemplatePhase {
  phase: Phase;
  weeks: number;
  /** A fully-off week in this phase is not counted and pushes the rest back. */
  extendable: boolean;
}
export type Template = TemplatePhase[];

export const DEFAULT_TEMPLATE: Template = [
  { phase: 'CLASS', weeks: 7, extendable: true },
  { phase: 'MID_BREAK', weeks: 1, extendable: false },
  { phase: 'CLASS', weeks: 6, extendable: true },
  { phase: 'VIVA', weeks: 1, extendable: true },
  { phase: 'FINALS', weeks: 4, extendable: true },
];

/** "From `asOfDate` this series is in `phase`, week `weekIndex`" (counted within that phase). */
export interface Checkpoint {
  asOfDate: string;
  phase: Phase;
  weekIndex: number;
}
export interface WeekOverride {
  weekStart: string;
  mode: 'FORCE_EXTEND' | 'NO_EXTEND';
}
/** "`phase` starts on `startDate`" whatever the computation says. MID_BREAK / VIVA / FINALS. */
export interface Pin {
  phase: Phase;
  startDate: string;
}

export interface TimelineInput {
  /** Normalised to the Saturday of its week. */
  startDate: string;
  template: Template;
  /** Holiday (not weekly off day) for THIS series on that date. */
  isOffDay: (date: string) => boolean;
  /** Holiday titles on a date, only used for the "reason" text. */
  titlesOn?: (date: string) => string[];
  /** JS weekdays (0 = Sunday) that are weekly off days. Default Thu, Fri. */
  weeklyOff?: number[];
  checkpoints?: Checkpoint[];
  weekOverrides?: WeekOverride[];
  pins?: Pin[];
}

export type WeekStatus = 'COUNTED' | 'HOLIDAY_SKIPPED' | 'FORCED_SKIP';

export interface TimelineWeek {
  weekStart: string; // a Saturday
  phase: Phase;
  /** Index in the template; tells apart the two CLASS blocks. */
  segment: number;
  /** Week number within the phase (CLASS counts across both blocks). null when skipped. */
  phaseWeekIndex: number | null;
  classWeekNo: number | null;
  status: WeekStatus;
  reason: string | null;
  /** Holiday titles behind a HOLIDAY_SKIPPED week (empty otherwise). */
  titles: string[];
}

export interface Timeline {
  weeks: TimelineWeek[];
  startDate: string; // first Saturday
  endDate: string; // last day of the last week
  /** false when the safety limit was hit before the template finished */
  completed: boolean;
  totalClassWeeks: number;
}

const MAX_WEEKS = 260;

/** The Saturday on or before `date` (weeks run Saturday to Friday). */
export const weekStartOf = (date: string) => addDays(date, -((weekdayOf(date) + 1) % 7));

const sumWeeks = (t: Template, upTo: number, pick: (p: TemplatePhase) => boolean) =>
  t.slice(0, upTo).reduce((n, p) => n + (pick(p) ? p.weeks : 0), 0);

/** Template position of "week k of `phase`", clamped to the last week of that phase. */
function locate(t: Template, phase: Phase, k: number): { s: number; d: number } | null {
  let acc = 0;
  let lastSeg = -1;
  for (const [i, p] of t.entries()) {
    if (p.phase !== phase) continue;
    if (k <= acc + p.weeks) return { s: i, d: Math.max(0, k - 1 - acc) };
    acc += p.weeks;
    lastSeg = i;
  }
  return lastSeg < 0 ? null : { s: lastSeg, d: t[lastSeg]!.weeks - 1 };
}

export function computeTimeline(input: TimelineInput): Timeline {
  const { template, isOffDay } = input;
  const weeklyOff = input.weeklyOff ?? [4, 5];
  const first = weekStartOf(input.startDate);
  const totalClassWeeks = sumWeeks(template, template.length, (p) => p.phase === 'CLASS');

  // Checkpoints take effect in the week that contains their date (not before the first week).
  // Later ones win when several land in the same week.
  const checkpoints = new Map<string, Checkpoint>();
  for (const c of [...(input.checkpoints ?? [])].sort((a, b) =>
    a.asOfDate.localeCompare(b.asOfDate),
  )) {
    const w = weekStartOf(c.asOfDate);
    checkpoints.set(w < first ? first : w, c);
  }
  const overrides = new Map(
    (input.weekOverrides ?? []).map((o) => [weekStartOf(o.weekStart), o.mode]),
  );
  const pins = (input.pins ?? []).flatMap((p) => {
    const seg = template.findIndex((t) => t.phase === p.phase);
    return seg > 0 ? [{ seg, week: weekStartOf(p.startDate) }] : [];
  });

  const weeks: TimelineWeek[] = [];
  let s = 0; // current template segment
  let d = 0; // weeks already counted in it
  let w = first;

  for (let guard = 0; s < template.length && guard < MAX_WEEKS; guard++, w = addDays(w, 7)) {
    const cp = checkpoints.get(w);
    const at = cp && locate(template, cp.phase, cp.weekIndex);
    if (at) ({ s, d } = at);

    // A pin makes its phase start this week, whatever came before.
    for (const p of pins) if (p.week === w && p.seg > s) ({ s, d } = { s: p.seg, d: 0 });

    // Reached a pinned phase early: wait for its date. These weeks do not count.
    if (d === 0 && pins.some((p) => p.seg === s && p.week > w)) {
      weeks.push({
        weekStart: w,
        phase: template[Math.max(0, s - 1)]!.phase,
        segment: Math.max(0, s - 1),
        phaseWeekIndex: null,
        classWeekNo: null,
        status: 'FORCED_SKIP',
        reason: `Waiting for the fixed start of ${template[s]!.phase}`,
        titles: [],
      });
      continue;
    }

    const seg = template[s]!;
    const working = Array.from({ length: 7 }, (_, i) => addDays(w, i)).filter(
      (day) => !weeklyOff.includes(weekdayOf(day)),
    );
    const fullyOff = working.length > 0 && working.every(isOffDay);
    const mode = overrides.get(w);
    // The week a pin names is the admin's fixed start of that phase: it is never skipped, even
    // if the week happens to be off, so the phase really starts on the date they typed.
    const pinnedStart = d === 0 && pins.some((p) => p.seg === s && p.week === w);
    const skip =
      seg.extendable &&
      mode !== 'NO_EXTEND' &&
      !pinnedStart &&
      (fullyOff || mode === 'FORCE_EXTEND');

    if (skip) {
      const titles = [...new Set(working.flatMap((day) => input.titlesOn?.(day) ?? []))];
      weeks.push({
        weekStart: w,
        phase: seg.phase,
        segment: s,
        phaseWeekIndex: null,
        classWeekNo: null,
        status: fullyOff ? 'HOLIDAY_SKIPPED' : 'FORCED_SKIP',
        reason: fullyOff ? titles.join(', ') || 'Holiday week' : 'Extended by admin',
        titles: fullyOff ? titles : [],
      });
      continue;
    }

    const index = sumWeeks(template, s, (p) => p.phase === seg.phase) + d + 1;
    weeks.push({
      weekStart: w,
      phase: seg.phase,
      segment: s,
      phaseWeekIndex: index,
      classWeekNo: seg.phase === 'CLASS' ? index : null,
      status: 'COUNTED',
      reason: !fullyOff
        ? null
        : pinnedStart
          ? 'Fixed start date, counted although the whole week is off'
          : 'Counted although the whole week is off',
      titles: [],
    });
    if (++d >= seg.weeks) ({ s, d } = { s: s + 1, d: 0 });
  }

  return {
    weeks,
    startDate: first,
    endDate: addDays(weeks[weeks.length - 1]?.weekStart ?? first, 6),
    completed: s >= template.length,
    totalClassWeeks,
  };
}

// --- State on a date ---------------------------------------------------------------------------

/**
 * COMPLETED: the admin marked the semester done. AWAITING_NEXT: its weeks are over but nobody
 * has completed it / started the next one ("পরের সেমিস্টার শুরুর তারিখ দিন").
 */
export type StatePhase = Phase | 'NOT_STARTED' | 'AWAITING_NEXT' | 'COMPLETED';

export interface SemesterState {
  phase: StatePhase;
  label: string; // "Class week 5/13", "Mid break", "Finals week 2/4", ...
  classWeekNo: number | null;
  totalClassWeeks: number;
  /** 0-1, counted weeks so far over all weeks the template needs. */
  progress: number;
  /** When the next phase starts. null once everything is done. */
  nextMilestone: { phase: Phase | 'ENDED'; date: string } | null;
  /** Weeks pushed back by holidays / admin, in the whole timeline. */
  delayedWeeks: number;
  /** Delays grouped by holiday: "পবিত্র রমজানের অবকাশ ও ঈদ-উল-ফিতর: +5 weeks". */
  reasons: DelayGroup[];
  /** This very week is a skipped (holiday) week. */
  onSkippedWeek: boolean;
  /** Week number inside the current phase, and how many weeks the phase has (both null if n/a). */
  phaseWeek: number | null;
  phaseWeeks: number | null;
}

/** A run of consecutive skipped weeks, named after the holidays behind it. */
export interface DelayGroup {
  reason: string;
  weeks: number;
  from: string; // first skipped week's Saturday
  to: string; // last skipped week's Saturday
}

/**
 * Skipped weeks are grouped into runs of consecutive weeks (one vacation = one entry), and each
 * run is named by its distinct holiday titles in order, joined with " ও ". So Ramadan + Eid
 * reads "পবিত্র রমজানের অবকাশ ও ঈদ-উল-ফিতর: 5 weeks", not one line per week.
 */
export function delayGroups(tl: Timeline): DelayGroup[] {
  const groups: (DelayGroup & { titles: Set<string> })[] = [];
  for (const w of tl.weeks) {
    if (w.status === 'COUNTED') continue;
    const last = groups[groups.length - 1];
    const label = w.titles.length > 0 ? w.titles : [w.reason ?? 'Delay'];
    if (last && addDays(last.to, 7) === w.weekStart) {
      last.to = w.weekStart;
      last.weeks++;
      for (const t of label) last.titles.add(t);
    } else {
      groups.push({
        reason: '',
        weeks: 1,
        from: w.weekStart,
        to: w.weekStart,
        titles: new Set(label),
      });
    }
  }
  return groups.map(({ titles, ...g }) => ({ ...g, reason: [...titles].join(' ও ') }));
}

/** Template weeks already behind the first week shown (a series that joined mid-semester). */
function weeksBefore(tl: Timeline, template: Template): number {
  const first = tl.weeks.find((w) => w.status === 'COUNTED');
  if (!first?.phaseWeekIndex) return 0;
  const sameBefore = sumWeeks(template, first.segment, (p) => p.phase === first.phase);
  return sumWeeks(template, first.segment, () => true) + (first.phaseWeekIndex - 1 - sameBefore);
}

const PHASE_NAME: Record<Phase, string> = {
  CLASS: 'Class',
  MID_BREAK: 'Mid break',
  VIVA: 'Viva',
  FINALS: 'Finals',
};

export function stateOn(
  tl: Timeline,
  template: Template,
  date: string,
  opts: { completed?: boolean } = {},
): SemesterState {
  const total = template.reduce((n, p) => n + p.weeks, 0);
  const skipped = tl.weeks.filter((x) => x.status !== 'COUNTED');
  const base = {
    totalClassWeeks: tl.totalClassWeeks,
    delayedWeeks: skipped.length,
    reasons: delayGroups(tl),
    phaseWeek: null as number | null,
    phaseWeeks: null as number | null,
  };

  // Marked done by an admin: nothing is coming, whatever the weeks say.
  if (opts.completed) {
    return {
      ...base,
      phase: 'COMPLETED',
      label: 'Semester completed',
      classWeekNo: null,
      progress: 1,
      nextMilestone: null,
      onSkippedWeek: false,
    };
  }

  if (date < tl.startDate) {
    return {
      ...base,
      phase: 'NOT_STARTED',
      label: 'Not started',
      classWeekNo: null,
      progress: 0,
      nextMilestone: { phase: 'CLASS', date: tl.startDate },
      onSkippedWeek: false,
    };
  }
  const i = tl.weeks.findIndex((x) => date >= x.weekStart && date < addDays(x.weekStart, 7));
  if (i < 0) {
    return {
      ...base,
      phase: 'AWAITING_NEXT',
      label: 'Semester ended: enter the next start date',
      classWeekNo: null,
      progress: 1,
      nextMilestone: null,
      onSkippedWeek: false,
    };
  }

  const now = tl.weeks[i]!;
  const counted = tl.weeks.slice(0, i + 1).filter((x) => x.status === 'COUNTED').length;
  const after = tl.weeks
    .slice(i + 1)
    .find((x) => x.status === 'COUNTED' && x.segment !== now.segment && x.phase !== now.phase);
  const next: SemesterState['nextMilestone'] = after
    ? { phase: after.phase, date: after.weekStart }
    : tl.completed
      ? { phase: 'ENDED', date: addDays(tl.endDate, 1) }
      : null;

  const phaseWeeks = template.filter((p) => p.phase === now.phase).reduce((n, p) => n + p.weeks, 0);
  const shown =
    now.phaseWeekIndex ??
    Math.max(
      1,
      tl.weeks.slice(0, i).filter((x) => x.status === 'COUNTED' && x.phase === now.phase).length,
    );
  let label: string;
  if (now.status !== 'COUNTED') label = `${PHASE_NAME[now.phase]}: holiday week`;
  else if (now.phase === 'MID_BREAK' || phaseWeeks === 1) label = PHASE_NAME[now.phase];
  else label = `${PHASE_NAME[now.phase]} week ${shown}/${phaseWeeks}`;

  return {
    ...base,
    phase: now.phase,
    label,
    classWeekNo: now.classWeekNo,
    phaseWeek: now.status === 'COUNTED' ? shown : null,
    phaseWeeks,
    progress: Math.min(1, (weeksBefore(tl, template) + counted) / total),
    nextMilestone: next,
    onSkippedWeek: now.status !== 'COUNTED',
  };
}
