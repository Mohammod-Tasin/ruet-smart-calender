import type {
  DelayGroup,
  SemesterState,
  StatePhase,
  Template,
  TimelineWeek,
} from '@/core/semester/timeline';
import { bn } from './rule-summary';

export type { DelayGroup, SemesterState, StatePhase, TimelineWeek, Template };

// --- API shapes -------------------------------------------------------------------------------

export interface StatusEntry {
  seriesId: number;
  series: string; // "CSE-23"
  semesterId: number;
  label: string | null;
  status: 'ACTIVE' | 'COMPLETED';
  state: SemesterState;
}
export interface StatusResponse {
  date: string;
  summary: Record<string, number>;
  series: StatusEntry[];
}
export interface TimelineResponse {
  semester: {
    id: number;
    seriesId: number;
    series: string;
    label: string | null;
    startDate: string;
    status: 'ACTIVE' | 'COMPLETED';
    template: Template;
  };
  weeks: TimelineWeek[];
  startDate: string;
  endDate: string;
  completed: boolean;
  totalClassWeeks: number;
  state: SemesterState;
}

// --- Bengali labels ---------------------------------------------------------------------------

export const PHASE_BN: Record<StatePhase, string> = {
  CLASS: 'ক্লাস',
  MID_BREAK: 'মিড ব্রেক',
  VIVA: 'ভাইভা',
  FINALS: 'সেমিস্টার ফাইনাল',
  AWAITING_NEXT: 'সেমিস্টার শেষ',
  COMPLETED: 'সম্পন্ন',
  NOT_STARTED: 'শুরু হয়নি',
};

/** "28 November" in Bengali: ২৮ নভেম্বর (with the year when `year` is set). */
export const bnDate = (iso: string, year = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('bn-BD', {
    day: 'numeric',
    month: 'long',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });

/** "ক্লাস সপ্তাহ ৫/১৩", "মিড ব্রেক", "সেমিস্টার ফাইনাল সপ্তাহ ২/৪", ... */
export function stateLineBn(s: SemesterState): string {
  const name = PHASE_BN[s.phase];
  if (s.onSkippedWeek) return `${name} · ছুটির সপ্তাহ`;
  if (s.phase === 'AWAITING_NEXT' || s.phase === 'COMPLETED' || s.phase === 'NOT_STARTED') {
    return name;
  }
  if (s.phase === 'MID_BREAK' || !s.phaseWeek || !s.phaseWeeks || s.phaseWeeks === 1) return name;
  return `${name} সপ্তাহ ${bn(s.phaseWeek)}/${bn(s.phaseWeeks)}`;
}

/** "পরবর্তী: মিড ব্রেক · ২৮ নভেম্বর" (null when nothing is coming). */
export function nextLineBn(s: SemesterState): string | null {
  const m = s.nextMilestone;
  if (!m) return null;
  const what = m.phase === 'ENDED' ? PHASE_BN.AWAITING_NEXT : PHASE_BN[m.phase];
  return `${what} ${bnDate(m.date)}`;
}

export const delayLineBn = (g: DelayGroup) => `${g.reason}: +${bn(g.weeks)} সপ্তাহ`;

// --- Colours (full class names, so Tailwind sees them) ---------------------------------------------

export const PHASE_STYLE: Record<StatePhase, { badge: string; bar: string; strip: string }> = {
  CLASS: {
    badge: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100',
    bar: 'bg-blue-600',
    strip: 'bg-blue-500 dark:bg-blue-600',
  },
  MID_BREAK: {
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
    bar: 'bg-amber-500',
    strip: 'bg-amber-400 dark:bg-amber-500',
  },
  VIVA: {
    badge: 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-100',
    bar: 'bg-purple-600',
    strip: 'bg-purple-500 dark:bg-purple-600',
  },
  FINALS: {
    badge: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100',
    bar: 'bg-orange-500',
    strip: 'bg-orange-500 dark:bg-orange-600',
  },
  COMPLETED: {
    badge: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100',
    bar: 'bg-green-600',
    strip: 'bg-green-500',
  },
  AWAITING_NEXT: {
    badge:
      'border border-dashed border-zinc-500 bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100',
    bar: 'bg-zinc-500',
    strip: 'bg-zinc-400',
  },
  NOT_STARTED: {
    badge: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
    bar: 'bg-zinc-400',
    strip: 'bg-zinc-300 dark:bg-zinc-600',
  },
};

/** A skipped (holiday) week: grey with diagonal hatching. */
export const SKIPPED_STRIP =
  'bg-zinc-300 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,rgb(0_0_0/0.35)_3px_5px)] dark:bg-zinc-600 dark:[background-image:repeating-linear-gradient(45deg,transparent_0_3px,rgb(255_255_255/0.35)_3px_5px)]';

/** A semester as the admin API returns it (with its corrections). */
export interface AdminSemester {
  id: number;
  seriesId: number;
  label: string | null;
  startDate: string;
  template: Template;
  status: 'ACTIVE' | 'COMPLETED';
  updatedAt: string;
  checkpoints: {
    id: number;
    asOfDate: string;
    phase: Exclude<StatePhase, 'NOT_STARTED' | 'AWAITING_NEXT' | 'COMPLETED'>;
    weekIndex: number;
    note: string | null;
  }[];
  weekOverrides: { weekStart: string; mode: 'FORCE_EXTEND' | 'NO_EXTEND'; note: string | null }[];
  pins: { phase: 'MID_BREAK' | 'VIVA' | 'FINALS'; startDate: string; note: string | null }[];
}
