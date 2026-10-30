import {
  bnDigits,
  DEFAULT_STRUCTURE,
  type JourneySemester,
  type JourneyState,
  type JourneyWeek,
  type JPhase,
} from '@/core/journey/journey';
import type { ApiStructure } from './api';

// Shapes of /api/status and /api/series/[id]/journey, plus the Bengali wording for them.

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

/** "CSE-23" -> "CSE-২৩" */
export const seriesName = (s: string) => bnDigits(s);
/** 1 -> "১-১", 8 -> "৪-২" */
export const semLabel = (n: number) => bnDigits(`${Math.ceil(n / 2)}-${n % 2 ? 1 : 2}`);

export const PHASE_BN: Record<JPhase, string> = {
  CLASS: 'ক্লাস',
  MID_BREAK: 'মিড ব্রেক',
  VIVA: 'ভাইভা',
  EXAM: 'পরীক্ষা',
  SEMESTER_BREAK: 'বিরতি',
};

/** "28 November" in Bengali: ২৮ নভেম্বর (with the year when `year` is set). */
export const bnDate = (iso: string, year = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('bn-BD', {
    day: 'numeric',
    month: 'long',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
/** "২৪ অক্টোবর", with a leading "~" when the date is only a projection. */
export const approxDate = (iso: string, confirmed: boolean, year = false) =>
  `${confirmed ? '' : '~'}${bnDate(iso, year)}`;

const ORDINAL: Record<number, string> = { 1: '১ম', 2: '২য়', 3: '৩য়', 4: '৪র্থ', 6: '৬ষ্ঠ' };
/** 3 -> "৩য়" */
export const nth = (n: number) => ORDINAL[n] ?? `${bnDigits(n)}ম`;

// ponytail: exam length read from the default structure; if an admin changes the structure the
// "x/4" in a matrix cell can be off by that much. Add `phaseWeeks` to the state when it matters.
const EXAM_WEEKS = DEFAULT_STRUCTURE.filter((b) => b.phase === 'EXAM').reduce(
  (n, b) => n + b.weeks,
  0,
);

/** Matrix cell: 2-3 words. */
export function cellText(s: JourneyState): string {
  if (s.status !== 'RUNNING' || !s.phase) return '—';
  if (s.onSkippedWeek) return 'ছুটি';
  const w = bnDigits(s.weekNo ?? 1);
  if (s.phase === 'CLASS') return `ক্লাস ${w}`;
  if (s.phase === 'EXAM') return `পরীক্ষা ${w}/${bnDigits(EXAM_WEEKS)}`;
  return PHASE_BN[s.phase];
}

/** Full sentence for the current phase: "পরীক্ষা চলছে (৩য় সপ্তাহ)". */
export function runningText(s: JourneyState): string {
  if (s.status !== 'RUNNING' || !s.phase) return '';
  if (s.onSkippedWeek) return 'ছুটির সপ্তাহ';
  const wk = ` (${nth(s.weekNo ?? 1)} সপ্তাহ)`;
  switch (s.phase) {
    case 'CLASS':
      return `ক্লাস চলছে${wk}`;
    case 'EXAM':
      return `পরীক্ষা চলছে${wk}`;
    case 'MID_BREAK':
      return 'মিড ব্রেক চলছে';
    case 'VIVA':
      return 'ভাইভা চলছে';
    default:
      return 'সেমিস্টার বিরতি চলছে';
  }
}

/** "CSE-২৩ · ২-২ · পরীক্ষা চলছে (৩য় সপ্তাহ) · ৩-১ শুরু ~২১ নভেম্বর" */
export function headline(e: StatusEntry): string {
  const s = e.state;
  const parts = [seriesName(e.series)];
  if (s.status === 'NONE') parts.push('শুরুর তারিখ এখনো দেওয়া হয়নি');
  else if (s.status === 'BEFORE') parts.push('এখনো শুরু হয়নি');
  else if (s.status === 'GRADUATED') parts.push('পড়াশোনা শেষ');
  else {
    if (s.semesterLabel) parts.push(s.semesterLabel);
    parts.push(runningText(s));
    if (s.nextSemester) {
      parts.push(
        `${semLabel(s.nextSemester.semesterNo)} শুরু ${approxDate(s.nextSemester.date, s.nextSemester.confirmed)}`,
      );
    } else if (s.nextMilestone?.phase === 'GRADUATION') {
      parts.push(`শেষ ~${bnDate(s.nextMilestone.date)}`);
    }
  }
  return parts.filter(Boolean).join(' · ');
}

/** "শীতকালীন ছুটি +২ সপ্তাহ" */
export const delayText = (r: { reason: string; weeks: number }) =>
  `${r.reason} +${bnDigits(r.weeks)} সপ্তাহ`;

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

/** Faculty code as shown to students: ECE -> FECE, CE -> FCE, ME -> FME. */
export const facultyShort = (code: string) => `F${code}`;

/** The series of a department code + intake year, if it exists. */
export const findSeries = (st: ApiStructure, deptCode: string, year: number) => {
  const d = st.departments.find((x) => x.code === deptCode);
  return d && st.series.find((s) => s.departmentId === d.id && s.intakeYear === year);
};
