/** One month style everywhere: "Sep", never "Sept" (Intl's en-GB gives "Sept"). */
export const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "2026-09-20" -> "Sep" */
export const monthShort = (iso: string) => MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]!;
