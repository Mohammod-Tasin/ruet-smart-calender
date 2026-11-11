import { addDays, weekdayOf } from '@/core/calendar/hijri';
import { layoutWeek, type Bar, type BarItem } from '@/core/calendar/lanes';
import { MONTHS_SHORT } from '@/core/calendar/months';
import type { HolidayReport, ReportCategory, ReportItem, ReportSeries } from './build';

// The data behind the visual PDF: a calendar grid of full Sat-Fri weeks with batch-grouped bars,
// and a few plain sentences per week. Pure; the React layout only draws it.

export interface PdfBar extends BarItem {
  text: string;
  category: ReportCategory;
  expected: boolean;
}
export interface PdfRow {
  dates: string[]; // 7, Saturday first
  bars: Bar<PdfBar>[];
  lanes: number;
}
export interface PdfTableRow {
  key: string;
  category: ReportCategory;
  who: string;
  type: string;
  /** Small grey line under the type ("Classes off · offices open"). */
  note?: string;
  off: string;
  back: string;
}
export interface PdfModel {
  title: string;
  from: string;
  to: string;
  rows: PdfRow[];
  /** Bar colours that actually appear on the grid (for the legend). */
  types: ReportCategory[];
  table: PdfTableRow[];
  weeklyOffDays: number[];
  weeklyOff: string;
  noStatus: string[];
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mon = (iso: string) => MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]!;
const dom = (iso: string) => Number(iso.slice(8, 10));

/** "11 Nov – 2 Dec 2026" */
export function longRange(a: string, b: string): string {
  const y = (iso: string) => iso.slice(0, 4);
  const left = y(a) === y(b) ? `${dom(a)} ${mon(a)}` : `${dom(a)} ${mon(a)} ${y(a)}`;
  return `${left} – ${dom(b)} ${mon(b)} ${y(b)}`;
}
/** "Wed 16 Dec" */
export const dayWd = (iso: string) => `${WD[weekdayOf(iso)]} ${dom(iso)} ${mon(iso)}`;
/** "Thu 12 – Fri 20 Nov", or "Wed 16 Dec" for one day. */
export function rangeWd(a: string, b: string): string {
  if (a === b) return dayWd(a);
  return a.slice(0, 7) === b.slice(0, 7)
    ? `${WD[weekdayOf(a)]} ${dom(a)} – ${WD[weekdayOf(b)]} ${dom(b)} ${mon(b)}`
    : `${dayWd(a)} – ${dayWd(b)}`;
}

const BREAK_NAME: Partial<Record<ReportCategory, string>> = {
  MID_BREAK: 'Mid-term break',
  SEMESTER_BREAK: 'Semester break',
};

interface Batch {
  year: number;
  ids: number[];
  codes: string[]; // department codes
  name: string; // "Batch 2024" or "CME-21"
  single: boolean;
}

/** One group per intake year; a lone series keeps its own name. Newest batch first. */
export function groupByBatch(ids: number[], series: ReportSeries[]): Batch[] {
  const byYear = new Map<number, ReportSeries[]>();
  for (const s of series)
    if (ids.includes(s.id)) byYear.set(s.intakeYear, [...(byYear.get(s.intakeYear) ?? []), s]);
  return [...byYear]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => {
      const sorted = [...list].sort((a, b) => a.label.localeCompare(b.label));
      return {
        year,
        ids: sorted.map((s) => s.id),
        codes: sorted.map((s) => s.label.split('-')[0]!),
        name: sorted.length === 1 ? sorted[0]!.label : `Batch ${year}`,
        single: sorted.length === 1,
      };
    });
}

const whoOf = (b: Batch) => (b.single ? b.name : `${b.name} · ${b.codes.join(', ')}`);

/** First day after `end` that is not a weekly holiday. */
function firstDayBack(end: string, off: number[]): string {
  let d = addDays(end, 1);
  while (off.includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
}

function barsOf(items: ReportItem[], series: ReportSeries[]): PdfBar[] {
  const out: PdfBar[] = [];
  for (const i of items) {
    if (i.seriesIds) {
      for (const b of groupByBatch(i.seriesIds, series)) {
        out.push({
          id: `${i.key}|${b.year}`,
          startDate: i.startDate,
          endDate: i.endDate,
          category: i.category,
          expected: false,
          text: whoOf(b), // who only; the table on page 2 has the type and dates
        });
      }
    } else {
      out.push({
        id: i.key,
        startDate: i.startDate,
        endDate: i.endDate,
        category: i.category,
        expected: i.expected,
        // Holidays show their title; unofficial breaks and suspensions show who only.
        text:
          i.who === 'Everyone'
            ? i.title
            : i.category === 'HOLIDAY'
              ? `${i.title} · ${i.who}`
              : i.who,
      });
    }
  }
  return out;
}

/** Every holiday / break once, sorted by start date. */
function tableOf(items: ReportItem[], series: ReportSeries[], rangeStart: string, off: number[]) {
  const offText = (i: ReportItem) =>
    (i.startDate < rangeStart ? `until ${dayWd(i.endDate)}` : rangeWd(i.startDate, i.endDate)) +
    (i.expected ? ' · expected' : '');
  const rows: { row: PdfTableRow; start: string; end: string }[] = [];
  for (const i of items) {
    if (i.seriesIds) {
      for (const b of groupByBatch(i.seriesIds, series)) {
        rows.push({
          row: {
            key: `${i.key}|${b.year}`,
            category: i.category,
            who: whoOf(b),
            type: BREAK_NAME[i.category]!,
            off: offText(i),
            back: dayWd(firstDayBack(i.endDate, off)),
          },
          start: i.startDate,
          end: i.endDate,
        });
      }
    } else {
      const everyone = i.who === 'Everyone';
      rows.push({
        row: {
          key: i.key,
          category: i.category,
          who: i.who,
          type: i.title,
          note: i.flags.length ? 'Classes off · offices open' : undefined,
          off: offText(i),
          back: everyone ? '–' : dayWd(firstDayBack(i.endDate, off)),
        },
        start: i.startDate,
        end: i.endDate,
      });
    }
  }
  return rows
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        a.end.localeCompare(b.end) ||
        a.row.type.localeCompare(b.row.type) ||
        a.row.who.localeCompare(b.row.who),
    )
    .map((x) => x.row);
}

export function buildPdfModel(r: HolidayReport): PdfModel {
  const all = r.weeks.flatMap((w) => w.items);
  const uniq = [...new Map(all.map((i) => [i.key, i])).values()];
  const bars = barsOf(uniq, r.series);
  // Exactly the three report weeks (Saturday to Friday).
  const rows: PdfRow[] = r.weeks.map((w) => {
    const dates = Array.from({ length: 7 }, (_, k) => addDays(w.start, k));
    const l = layoutWeek(dates, bars);
    return { dates, bars: l.bars, lanes: l.lanes };
  });
  const seen = new Set(rows.flatMap((x) => x.bars.map((b) => b.item.category)));
  return {
    title: `RUET Holidays & Breaks · ${longRange(r.from, r.to)}`,
    from: r.from,
    to: r.to,
    rows,
    types: (
      ['HOLIDAY', 'MID_BREAK', 'SEMESTER_BREAK', 'SUSPENDED_WEEK', 'UNOFFICIAL_BREAK'] as const
    ).filter((c) => seen.has(c)),
    table: tableOf(uniq, r.series, r.from, r.weeklyOffDays),
    weeklyOffDays: r.weeklyOffDays,
    weeklyOff: r.weeklyOff.join(' and '),
    noStatus: r.noStatus,
  };
}
