import type { RuleParams } from './rules';

// The verified RUET 2026 holiday list (docs/phase-9-11-spec.md §7). All audiences are ALL.
// Pure data so a unit test can check the Hijri rules reproduce these dates.

export interface SeedRule {
  title: string;
  classesOnly?: boolean;
  params: RuleParams;
  /** The official 2026 dates. HIJRI overrides are stored with confirmed = true. */
  y2026?: { startDate: string; endDate: string };
}

const fixed = (month: number, day: number, lengthDays = 1): RuleParams => ({
  kind: 'GREGORIAN_FIXED',
  month,
  day,
  lengthDays,
});
const hp = (month: number, day: number, offsetDays = 0) => ({ month, day, offsetDays });
const hijri = (s: [number, number, number?], e: [number, number, number?] = s): RuleParams => ({
  kind: 'HIJRI',
  startHijri: hp(...s),
  endHijri: hp(...e),
});
const lastWeekday = (hijriMonth: number, weekday: number): RuleParams => ({
  kind: 'HIJRI',
  type: 'LAST_WEEKDAY',
  hijriMonth,
  weekday,
});
const manual = (defaultLengthDays: number): RuleParams => ({
  kind: 'MANUAL_YEARLY',
  defaultLengthDays,
});
const on = (startDate: string, endDate = startDate) => ({ startDate, endDate });

export const SEED_RULES: SeedRule[] = [
  // A. Fixed Gregorian dates
  { title: 'শহিদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস', params: fixed(2, 21) },
  { title: 'স্বাধীনতা ও জাতীয় দিবস', params: fixed(3, 26) },
  { title: 'বাংলা নববর্ষ', params: fixed(4, 14) },
  { title: 'মে দিবস', params: fixed(5, 1) },
  { title: 'জুলাই গণঅভ্যুত্থান দিবস', params: fixed(8, 5) },
  { title: 'বিশ্ববিদ্যালয় দিবস', classesOnly: true, params: fixed(9, 1) },
  { title: 'শহিদ বুদ্ধিজীবী দিবস', params: fixed(12, 14) },
  { title: 'বিজয় দিবস', params: fixed(12, 16) },
  { title: 'শীতকালীন ছুটি', params: fixed(12, 19, 13) },
  { title: 'বড়দিন', params: fixed(12, 25) },

  // B. Islamic days. Months: 1 Muharram, 2 Safar, 3 Rabi-ul-Awal, 4 Rabi-us-Sani, 7 Rajab,
  // 8 Sha'ban, 9 Ramadan, 10 Shawwal, 12 Dhul-Hijjah. Offsets are on top of HIJRI_BD_DAY_OFFSET.
  { title: 'শব-ই-মিরাজ', params: hijri([7, 27]), y2026: on('2026-01-17') },
  { title: 'শব-ই-বরাত', params: hijri([8, 15]), y2026: on('2026-02-04') },
  {
    title: 'পবিত্র রমজানের অবকাশ',
    classesOnly: true,
    params: hijri([9, 1], [10, 1, -1]), // 1 Ramadan -> last day of Ramadan (= 1 Shawwal - 1)
    y2026: on('2026-02-19', '2026-03-20'),
  },
  {
    title: 'ঈদ-উল-ফিতর',
    params: hijri([10, 1, -7], [10, 1, 4]),
    y2026: on('2026-03-14', '2026-03-25'),
  },
  { title: 'শব-ই-কদর', params: hijri([9, 27]), y2026: on('2026-03-17') },
  { title: 'জুমাতুল বিদা', params: lastWeekday(9, 5), y2026: on('2026-03-20') }, // last Friday
  {
    title: 'ঈদ-উল-আযহা',
    params: hijri([12, 10, -2], [12, 10, 6]),
    y2026: on('2026-05-26', '2026-06-03'),
  },
  { title: 'মুহাররম (আশুরা)', params: hijri([1, 10]), y2026: on('2026-06-26') },
  { title: 'আখেরী চাহার সোম্বা', params: lastWeekday(2, 3), y2026: on('2026-08-12') }, // last Wednesday
  { title: 'ঈদ-ই-মিলাদুন্নবী (সাঃ)', params: hijri([3, 12]), y2026: on('2026-08-26') },
  { title: 'ফাতেহা-ই-ইয়াজদাহম', params: hijri([4, 11, 1]), y2026: on('2026-09-24') },

  // C. Dates an admin enters every year
  { title: 'সনাতনী ছুটি', params: manual(1), y2026: on('2026-01-23') },
  { title: 'বুদ্ধ পূর্ণিমা (বৈশাখী পূর্ণিমা)', params: manual(1), y2026: on('2026-05-01') },
  { title: 'গ্রীষ্মকালীন ছুটি', params: manual(5), y2026: on('2026-05-21', '2026-05-25') },
  { title: 'সনাতনী ছুটি', params: manual(1), y2026: on('2026-09-04') },
  { title: 'সনাতনী ছুটি', params: manual(5), y2026: on('2026-10-17', '2026-10-21') },
];
