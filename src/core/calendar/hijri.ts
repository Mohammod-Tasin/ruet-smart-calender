// Hijri (Umm al-Qura) -> Gregorian using the built-in Intl calendar: no library.
// Dates are "YYYY-MM-DD" strings and all maths is UTC, so time zones never interfere.

const DAY_MS = 86_400_000;
const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (ms: number) => {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
export const msOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso: string, n: number) => isoOf(msOf(iso) + n * DAY_MS);
export const weekdayOf = (iso: string) => new Date(msOf(iso)).getUTCDay(); // 0 = Sunday

/** Gregorian day-1 of every Hijri month that starts in [year-1, year+1], keyed "hy-hm". */
const cache = new Map<number, Map<string, string>>();
function monthStarts(year: number): Map<string, string> {
  let m = cache.get(year);
  if (m) return m;
  m = new Map();
  for (let t = Date.UTC(year - 1, 0, 1); t <= Date.UTC(year + 1, 11, 31); t += DAY_MS) {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
    if (Number(p.day) === 1) m.set(`${p.relatedYear ?? p.year}-${p.month}`, isoOf(t));
  }
  cache.set(year, m);
  return m;
}

/** Hijri years that have a month starting within the Gregorian year `year` (+/- a year). */
export function hijriYearsAround(year: number): number[] {
  const ys = new Set([...monthStarts(year).keys()].map((k) => Number(k.split('-')[0])));
  return [...ys].sort((a, b) => a - b);
}

/** Saudi (umalqura) Gregorian date of a Hijri date, plus `extraDays` (BD offset + rule offset). */
export function hijriToGregorian(
  hy: number,
  hm: number,
  hd: number,
  extraDays: number,
  nearYear: number,
): string | null {
  const first = monthStarts(nearYear).get(`${hy}-${hm}`);
  return first ? addDays(first, hd - 1 + extraDays) : null;
}

/** Last day (inclusive) of a Hijri month, with the BD offset applied to both ends. */
export function hijriMonthEnd(
  hy: number,
  hm: number,
  extraDays: number,
  nearYear: number,
): string | null {
  const [ny, nm] = hm === 12 ? [hy + 1, 1] : [hy, hm + 1];
  const next = hijriToGregorian(ny, nm, 1, extraDays, nearYear);
  return next ? addDays(next, -1) : null;
}
