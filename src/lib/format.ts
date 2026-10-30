import { monthShort } from '@/core/calendar/months';
import { rangeText } from './journey-ui';
import { WEEKDAYS_EN } from './rule-summary';

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

export const monthTitle = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const shortDate = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${monthShort(iso)} ${iso.slice(0, 4)}`;

export const longDate = (iso: string) =>
  utc(iso).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** "ALL" is shown to people as "Everyone". */
export const audienceText = (label: string) => (label === 'ALL' ? 'Everyone' : label);

export const dateRange = (start: string, end: string) =>
  start === end ? shortDate(start) : `${shortDate(start)} – ${shortDate(end)}`;

/** A timestamp (ISO instant) shown as a date in the business time zone. */
export const stamp = (instant: string) =>
  shortDate(new Date(instant).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }));

/**
 * "Thursday and Friday are weekly holidays, so we saved 17–21 Oct." `verb` is "saved" after a
 * save (the server already trimmed) and "will save" while the admin is still typing.
 */
export function trimNote(
  r: { startDate: string; endDate: string },
  offDays: number[],
  verb: 'saved' | 'will save' = 'saved',
): string {
  const names = [...offDays].sort().map((d) => WEEKDAYS_EN[d]!);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `${list} ${names.length > 1 ? 'are weekly holidays' : 'is a weekly holiday'}, so we ${verb} ${rangeText(r.startDate, r.endDate)}.`;
}
