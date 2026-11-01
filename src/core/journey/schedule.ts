import type { JourneyStructure } from './journey';

// Per-semester schedule override (docs/phase-14-edit-anything-spec.md §2). The default structure
// stays in academic_settings; one series' one semester may differ (e.g. mid-term break after class
// week 8). Four numbers describe it; the rest of the structure is fixed.

export interface ScheduleFields {
  /** Class weeks before the mid-term break. */
  classesBefore: number;
  /** Class weeks after it. */
  classesAfter: number;
  /** Board Viva weeks. */
  vivaWeeks: number;
  /** Semester Final weeks. */
  finalWeeks: number;
}

const block = (phase: JourneyStructure[number]['phase'], weeks: number, extendable: boolean) =>
  weeks > 0 ? [{ phase, weeks, extendable }] : [];

/** CLASS · MID_BREAK 1 · CLASS · VIVA · EXAM · SEMESTER_BREAK 1, like the default. */
export const structureFromFields = (f: ScheduleFields): JourneyStructure => [
  ...block('CLASS', f.classesBefore, true),
  { phase: 'MID_BREAK', weeks: 1, extendable: true },
  ...block('CLASS', f.classesAfter, true),
  ...block('VIVA', f.vivaWeeks, true),
  ...block('EXAM', f.finalWeeks, true),
  { phase: 'SEMESTER_BREAK', weeks: 1, extendable: true },
];

/** The four numbers of a structure, or null if it is not shaped like the default. */
export function fieldsFromStructure(s: JourneyStructure): ScheduleFields | null {
  const weeks = (phase: string, nth = 0) => s.filter((b) => b.phase === phase)[nth]?.weeks ?? 0;
  const f = {
    classesBefore: weeks('CLASS', 0),
    classesAfter: weeks('CLASS', 1),
    vivaWeeks: weeks('VIVA'),
    finalWeeks: weeks('EXAM'),
  };
  return JSON.stringify(structureFromFields(f)) === JSON.stringify(s) ? f : null;
}

/** null when valid, else a plain message. */
export function scheduleProblem(f: ScheduleFields): string | null {
  const all = [f.classesBefore, f.classesAfter, f.vivaWeeks, f.finalWeeks];
  if (!all.every((n) => Number.isInteger(n) && n >= 0))
    return 'Weeks must be whole numbers, 0 or more.';
  const total = f.classesBefore + f.classesAfter;
  if (total < 1 || total > 20) return 'Class weeks must add up to between 1 and 20.';
  if (f.finalWeeks < 1 || f.finalWeeks > 8) return 'Semester Final must be 1 to 8 weeks.';
  if (f.vivaWeeks > 4) return 'Board Viva can be at most 4 weeks.';
  return null;
}

/** "Mid-term break will start Sat 21 Nov (after class week 8)." needs the date; this is the part after. */
export const afterClassWeek = (f: ScheduleFields) => `after class week ${f.classesBefore}`;

export const sameFields = (a: ScheduleFields, b: ScheduleFields) =>
  a.classesBefore === b.classesBefore &&
  a.classesAfter === b.classesAfter &&
  a.vivaWeeks === b.vivaWeeks &&
  a.finalWeeks === b.finalWeeks;
