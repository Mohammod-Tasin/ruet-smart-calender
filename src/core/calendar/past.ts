import { monthShort } from './months';
import type { DateRange } from './trim';

// Time rules for editing holidays (docs/phase-14-edit-anything-spec.md §5). Pure: `today` is the
// Asia/Dhaka date and is always passed in, so every rule is testable with a fixed "today".
// The server runs these inside the write transaction; the UI only mirrors them.

/** Which years a change to a yearly holiday applies to. */
export type EditScope = 'ONLY_YEAR' | 'FROM_YEAR' | 'FROM_NEXT_YEAR';

/** A range that starts before today touches the past (a running holiday does too). */
export const touchesPast = (r: DateRange, today: string) => r.startDate < today;

export const pastMessage = (n: number) =>
  n > 0
    ? `This holiday is in the past. Changing it recalculates the semester history of ${n} series.`
    : 'This holiday is in the past. Changing it does not move any series.';

const day = (iso: string, withYear: boolean) =>
  `${Number(iso.slice(8, 10))} ${monthShort(iso)}${withYear ? ` ${iso.slice(0, 4)}` : ''}`;
/** "16 Dec", "13–15 Dec 2026", "30 Nov – 2 Dec". */
export function spanText(r: DateRange, withYear = false): string {
  if (r.startDate === r.endDate) return day(r.startDate, withYear);
  if (r.startDate.slice(0, 7) === r.endDate.slice(0, 7)) {
    return `${Number(r.startDate.slice(8, 10))}–${day(r.endDate, withYear)}`;
  }
  return `${day(r.startDate, false)} – ${day(r.endDate, withYear)}`;
}

export interface OccurrenceEditInput {
  today: string;
  year: number;
  ruleKind: 'GREGORIAN_FIXED' | 'HIJRI' | 'MANUAL_YEARLY';
  /** What the calendar shows for `year` now. */
  original: DateRange;
  /** What the admin typed (after the weekly-off trim). */
  proposed: DateRange;
  scope: EditScope;
  confirmPast: boolean;
}

export type OccurrenceEditPlan =
  | {
      ok: true;
      /** Dates `year` ends up with (only meaningful unless scope is FROM_NEXT_YEAR). */
      dates: DateRange;
      /** The pattern for the new rule version (what the admin typed, never clipped). */
      pattern: DateRange;
      clipped: boolean;
      /** The original is already over: this rewrites history (was confirmed). */
      pastEdit: boolean;
      /** One line to show the admin when something was adjusted. */
      note: string | null;
    }
  | { ok: false; code: 'PAST_CONFIRM' | 'UNPROCESSABLE'; message: string };

const no = (code: 'PAST_CONFIRM' | 'UNPROCESSABLE', message: string) =>
  ({ ok: false, code, message }) as const;

export function planOccurrenceEdit(i: OccurrenceEditInput): OccurrenceEditPlan {
  const { today, year, original, proposed, scope } = i;
  const base = { dates: proposed, pattern: proposed, clipped: false, pastEdit: false, note: null };

  if (i.ruleKind === 'MANUAL_YEARLY' && scope !== 'ONLY_YEAR') {
    return no(
      'UNPROCESSABLE',
      'This holiday has no yearly pattern. Set its dates one year at a time.',
    );
  }
  // Next year onward never touches this year, so the calendar of the past is safe.
  if (scope === 'FROM_NEXT_YEAR') return { ok: true, ...base };

  // Rule 2: the original is over. Only through the "Fix a past holiday" step.
  if (original.endDate < today) {
    return i.confirmPast ? { ok: true, ...base, pastEdit: true } : no('PAST_CONFIRM', '');
  }

  // Rule 1: the new dates are already gone. This year cannot change, next year can.
  if (proposed.endDate < today) {
    return no(
      'UNPROCESSABLE',
      `${spanText(proposed, true)} has already passed, so this change starts from ${year + 1}. This year's holiday stays on ${spanText(original)}.`,
    );
  }

  // Rule 3: the holiday is running. Days before today keep what they were; only the rest changes.
  if (original.startDate >= today && proposed.startDate >= today) return { ok: true, ...base };
  const startDate = original.startDate < today ? original.startDate : today;
  if (original.startDate < today && proposed.startDate > today) {
    return no(
      'UNPROCESSABLE',
      `This holiday already started on ${spanText({ startDate: original.startDate, endDate: original.startDate })}. Days before today cannot change, so the new dates must include today.`,
    );
  }
  const dates = { startDate, endDate: proposed.endDate };
  const clipped = dates.startDate !== proposed.startDate;
  if (clipped && scope === 'FROM_YEAR') {
    return no(
      'UNPROCESSABLE',
      `Days before today cannot change, so these dates fit "Only ${year}" or "Every year from ${year + 1}", not "${year} and every year after".`,
    );
  }
  return {
    ok: true,
    ...base,
    dates,
    clipped,
    note: clipped
      ? `Days before today cannot change, so we'll save ${spanText(dates, true)}.`
      : null,
  };
}

/**
 * One-off holidays and class suspensions: any create, date/audience change, delete or restore
 * whose old or new range touches a day before today needs the "Fix a past holiday" confirm.
 */
export const needsPastConfirm = (
  today: string,
  ranges: (DateRange | null | undefined)[],
): boolean => ranges.some((r) => !!r && touchesPast(r, today));
