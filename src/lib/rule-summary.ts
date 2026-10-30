import type { HijriPoint, RuleParams } from '@/core/calendar/rules';

const GREGORIAN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const HIJRI_MONTHS = [
  'Muharram',
  'Safar',
  'Rabi-ul-Awal',
  'Rabi-us-Sani',
  'Jumada-ul-Awal',
  'Jumada-us-Sani',
  'Rajab',
  "Sha'ban",
  'Ramadan',
  'Shawwal',
  "Dhul-Qa'dah",
  'Dhul-Hijjah',
];
export const WEEKDAYS_EN = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const hijriPoint = (p: HijriPoint) =>
  `${p.day} ${HIJRI_MONTHS[p.month - 1]}` +
  (p.offsetDays ? ` ${p.offsetDays > 0 ? '+' : '−'} ${plural(Math.abs(p.offsetDays), 'day')}` : '');

/** One line describing a rule, e.g. "Every year on 21 February" or "1 Ramadan → 1 Shawwal − 1 day". */
export function ruleSummary(p: RuleParams): string {
  if (p.kind === 'GREGORIAN_FIXED') {
    const day = `${p.day} ${GREGORIAN_MONTHS[p.month - 1]}`;
    return `Every year on ${day}${p.lengthDays > 1 ? ` (${plural(p.lengthDays, 'day')})` : ''}`;
  }
  if (p.kind === 'MANUAL_YEARLY') {
    return `Dates entered by hand each year (usually ${plural(p.defaultLengthDays, 'day')})`;
  }
  if ('type' in p) {
    return `Last ${WEEKDAYS_EN[p.weekday]} of ${HIJRI_MONTHS[p.hijriMonth - 1]}`;
  }
  const same = JSON.stringify(p.startHijri) === JSON.stringify(p.endHijri);
  return same
    ? hijriPoint(p.startHijri)
    : `${hijriPoint(p.startHijri)} → ${hijriPoint(p.endHijri)}`;
}

export const KIND_LABEL = {
  GREGORIAN_FIXED: 'Fixed date',
  HIJRI: 'Moon-based',
  MANUAL_YEARLY: 'Manual each year',
} as const;
