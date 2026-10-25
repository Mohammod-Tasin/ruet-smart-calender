import type { HijriPoint, RuleParams } from '@/core/calendar/rules';

const DIGITS = '০১২৩৪৫৬৭৮৯';
export const bn = (n: number) => String(n).replace(/\d/g, (d) => DIGITS[Number(d)]!);

const GREGORIAN_MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];
export const HIJRI_MONTHS = [
  'মুহাররম',
  'সফর',
  'রবিউল আউয়াল',
  'রবিউস সানি',
  'জমাদিউল আউয়াল',
  'জমাদিউস সানি',
  'রজব',
  "শা'বান",
  'রমজান',
  'শাওয়াল',
  'জিলকদ',
  'জিলহজ',
];
export const WEEKDAYS_BN = [
  'রবিবার',
  'সোমবার',
  'মঙ্গলবার',
  'বুধবার',
  'বৃহস্পতিবার',
  'শুক্রবার',
  'শনিবার',
];

const hijriPoint = (p: HijriPoint) =>
  `${bn(p.day)} ${HIJRI_MONTHS[p.month - 1]}` +
  (p.offsetDays ? ` ${p.offsetDays > 0 ? '+' : '−'} ${bn(Math.abs(p.offsetDays))} দিন` : '');

/** One line describing a rule, e.g. "প্রতি বছর ২১ ফেব্রুয়ারি" or "১ রমজান → ১ শাওয়াল − ১ দিন". */
export function ruleSummary(p: RuleParams): string {
  if (p.kind === 'GREGORIAN_FIXED') {
    const day = `${bn(p.day)} ${GREGORIAN_MONTHS[p.month - 1]}`;
    return `প্রতি বছর ${day}${p.lengthDays > 1 ? ` (${bn(p.lengthDays)} দিন)` : ''}`;
  }
  if (p.kind === 'MANUAL_YEARLY') {
    return `প্রতি বছর, তারিখ হাতে দিতে হয় (সাধারণত ${bn(p.defaultLengthDays)} দিন)`;
  }
  if ('type' in p) return `${HIJRI_MONTHS[p.hijriMonth - 1]} মাসের শেষ ${WEEKDAYS_BN[p.weekday]}`;
  const same = JSON.stringify(p.startHijri) === JSON.stringify(p.endHijri);
  return same
    ? hijriPoint(p.startHijri)
    : `${hijriPoint(p.startHijri)} → ${hijriPoint(p.endHijri)}`;
}

export const KIND_LABEL = {
  GREGORIAN_FIXED: 'Fixed date',
  HIJRI: 'Hijri',
  MANUAL_YEARLY: 'Manual each year',
} as const;
