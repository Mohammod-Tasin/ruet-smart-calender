import { todayInDhaka } from '@/core/calendar/grid';
import { monthShort } from '@/core/calendar/months';
import {
  semesterLabel,
  type JourneySemester,
  type JourneyState,
  type JourneyWeek,
  type JPhase,
} from '@/core/journey/journey';
import type { ApiStructure } from './api';

// Shapes of /api/status and /api/series/[id]/journey, plus the wording for them.

export interface StatusEntry {
  seriesId: number;
  series: string; // "CSE-23"
  departmentId: number;
  intakeYear: number;
  state: JourneyState;
}
export interface StatusResponse {
  date: string;
  summary: Record<string, number>;
  series: StatusEntry[];
}
export interface PositionRow {
  id: number;
  asOfDate: string;
  semesterNo: number;
  phase: JPhase;
  weekNo: number;
  kind: 'POSITION' | 'SEMESTER_START';
}
export interface JourneyResponse {
  seriesId: number;
  series: string;
  intakeYear: number;
  state: JourneyState;
  semesters: JourneySemester[];
  weeks: JourneyWeek[];
  graduation: string | null;
  positions: PositionRow[];
}

/** Series are shown as "CSE-23". */
export const seriesName = (s: string) => s;
/** 1 -> "1-1", 8 -> "4-2" */
export const semLabel = (n: number) => semesterLabel(n);

// The fixed vocabulary (docs/phase-13-simple-ux-spec.md §1). Use these everywhere.
export const PHASE_LABEL: Record<JPhase, string> = {
  CLASS: 'Class',
  MID_BREAK: 'Mid-term break',
  VIVA: 'Board Viva',
  EXAM: 'Semester Final',
  SEMESTER_BREAK: 'Semester break',
};
/** Short name used in chips and matrix cells ("Final 2/4"). */
export const PHASE_SHORT: Record<JPhase, string> = { ...PHASE_LABEL, EXAM: 'Final' };

/** "21 Nov", with the year ("21 Nov 2027") when it is not the current year. */
export function dayText(iso: string): string {
  const sameYear = iso.slice(0, 4) === todayInDhaka().slice(0, 4);
  return `${Number(iso.slice(8, 10))} ${monthShort(iso)}${sameYear ? '' : ` ${iso.slice(0, 4)}`}`;
}
/** "21–25 Oct", "30 Oct – 2 Nov" or "21 Oct" (one day). */
export function rangeText(start: string, end: string): string {
  if (start === end) return dayText(start);
  const [a, b] = [new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`)];
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${a.getUTCDate()}–${dayText(end)}`;
  }
  return `${dayText(start)} – ${dayText(end)}`;
}
/** "around 21 Nov" while the date is only a projection. */
export const approxDate = (iso: string, confirmed: boolean) =>
  confirmed ? dayText(iso) : `around ${dayText(iso)}`;

/** Matrix cell: 2-3 words. */
export function cellText(s: JourneyState): string {
  if (s.status !== 'RUNNING' || !s.phase) return 'No data';
  if (s.onSkippedWeek) return 'Holiday';
  const w = s.weekNo ?? 1;
  if (s.phase === 'CLASS') return `Class ${w}/${s.phaseWeeks ?? '?'}`;
  if (s.phase === 'EXAM') return `Final ${w}/${s.phaseWeeks ?? '?'}`;
  return PHASE_SHORT[s.phase];
}

/** Full sentence for the current phase: "Semester Final · week 2 of 4". */
export function runningText(s: JourneyState): string {
  if (s.status !== 'RUNNING' || !s.phase) return '';
  if (s.onSkippedWeek) return 'Holiday week';
  const of = s.phaseWeeks ? ` of ${s.phaseWeeks}` : '';
  if (s.phase === 'CLASS') return `Class week ${s.weekNo ?? 1}${of}`;
  if (s.phase === 'EXAM') return `${PHASE_LABEL.EXAM} · week ${s.weekNo ?? 1}${of}`;
  return PHASE_LABEL[s.phase];
}

/** "CSE-23 · Semester 2-2 · Semester Final · week 2 of 4 · 3-1 starts around 21 Nov" */
export function headline(e: StatusEntry): string {
  const s = e.state;
  const parts = [e.series];
  if (s.status === 'NONE') parts.push('No data yet');
  else if (s.status === 'BEFORE') parts.push('Not started yet');
  else if (s.status === 'GRADUATED') parts.push('Graduated');
  else {
    if (s.semesterLabel) parts.push(`Semester ${s.semesterLabel}`);
    parts.push(runningText(s));
    if (s.nextSemester) {
      parts.push(
        `${semLabel(s.nextSemester.semesterNo)} starts ${approxDate(s.nextSemester.date, s.nextSemester.confirmed)}`,
      );
    } else if (s.nextMilestone?.phase === 'GRADUATION') {
      parts.push(`Ends around ${dayText(s.nextMilestone.date)}`);
    }
  }
  return parts.filter(Boolean).join(' · ');
}

/** "Sanatani Holiday (17–21 Oct)" */
export const delayText = (r: { reason: string; start: string; end: string }) =>
  `${r.reason} (${rangeText(r.start, r.end)})`;
/** "1 week", "2 weeks" */
export const weeksText = (n: number) => `${n} week${n === 1 ? '' : 's'}`;

// Full class names, so Tailwind sees them.
export const PHASE_STYLE: Record<JPhase, { cell: string; strip: string }> = {
  CLASS: {
    cell: 'bg-blue-100 text-blue-950 dark:bg-blue-950 dark:text-blue-100',
    strip: 'bg-blue-500 dark:bg-blue-600',
  },
  MID_BREAK: {
    cell: 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100',
    strip: 'bg-amber-400 dark:bg-amber-500',
  },
  VIVA: {
    cell: 'bg-purple-100 text-purple-950 dark:bg-purple-950 dark:text-purple-100',
    strip: 'bg-purple-500 dark:bg-purple-600',
  },
  EXAM: {
    cell: 'bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-100',
    strip: 'bg-orange-500 dark:bg-orange-600',
  },
  SEMESTER_BREAK: {
    cell: 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100',
    strip: 'bg-emerald-500 dark:bg-emerald-600',
  },
};
export const NONE_CELL =
  'border border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400';
/** A skipped (holiday) week: grey with diagonal hatching. */
export const SKIPPED_STRIP =
  'bg-zinc-300 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,rgb(0_0_0/0.35)_3px_5px)] dark:bg-zinc-600 dark:[background-image:repeating-linear-gradient(45deg,transparent_0_3px,rgb(255_255_255/0.35)_3px_5px)]';

/** The series of a department code + intake year, if it exists. */
export const findSeries = (st: ApiStructure, deptCode: string, year: number) => {
  const d = st.departments.find((x) => x.code === deptCode);
  return d && st.series.find((s) => s.departmentId === d.id && s.intakeYear === year);
};
