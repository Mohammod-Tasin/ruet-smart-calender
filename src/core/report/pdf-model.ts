import { addDays, weekdayOf } from '@/core/calendar/hijri';
import { layoutWeek, type Bar, type BarItem } from '@/core/calendar/lanes';
import { MONTHS_SHORT } from '@/core/calendar/months';
import type { HolidayReport, ReportCategory, ReportItem, ReportSeries } from './build';

// The data behind the visual PDF: a calendar grid of full Sat-Fri weeks with batch-grouped bars,
// and a few plain sentences per week. Pure; the React layout only draws it.

export interface PdfBar extends BarItem {
  /** "<who> · <type>". */
  text: string;
  /** Shorter label (no department names) for when `text` does not fit the bar. */
  alt?: string;
  category: ReportCategory;
  expected: boolean;
}
export interface PdfRow {
  dates: string[]; // 7, Saturday first
  bars: Bar<PdfBar>[];
  lanes: number;
}
export interface PdfEntry {
  category: ReportCategory;
  text: string;
  /** Second line, e.g. the departments of a batch. */
  sub?: string;
  /** Third line: "Batch 2024 returns to class on Sat 21 Nov". */
  resume?: string;
}
export interface PdfSummaryLine {
  week: string; // "Week 1 · 14–20 Nov"
  parts: { category: ReportCategory; text: string }[];
}
export interface PdfModel {
  title: string;
  from: string;
  to: string;
  summary: { title: string; lines: PdfSummaryLine[] };
  rows: PdfRow[];
  /** Bar colours that actually appear on the grid (for the legend). */
  types: ReportCategory[];
  weeks: { heading: string; entries: PdfEntry[] }[];
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
      const type = BREAK_NAME[i.category]!;
      for (const b of groupByBatch(i.seriesIds, series)) {
        out.push({
          id: `${i.key}|${b.year}`,
          startDate: i.startDate,
          endDate: i.endDate,
          category: i.category,
          expected: false,
          text: `${whoOf(b)} · ${type}`,
          alt: b.single ? undefined : `${b.name} · ${type}`,
        });
      }
    } else {
      // Holidays, suspensions, unofficial breaks: "<who> · <title>"; the title is as stored.
      out.push({
        id: i.key,
        startDate: i.startDate,
        endDate: i.endDate,
        category: i.category,
        expected: i.expected,
        text: `${i.who} · ${i.title}`,
        alt: i.title,
      });
    }
  }
  return out;
}

function entriesOf(
  items: ReportItem[],
  win: { start: string; end: string },
  series: ReportSeries[],
  off: number[],
): PdfEntry[] {
  const entries: PdfEntry[] = [];
  for (const i of items) {
    if (i.seriesIds) {
      const name = BREAK_NAME[i.category]!.toLowerCase();
      const back = firstDayBack(i.endDate, off);
      for (const b of groupByBatch(i.seriesIds, series)) {
        entries.push({
          category: i.category,
          text:
            i.startDate < win.start
              ? `${b.name} is on ${name} until ${dayWd(i.endDate)}`
              : `${b.name} has ${name}, ${rangeWd(i.startDate, i.endDate)}`,
          sub: b.single ? undefined : b.codes.join(', '),
          resume:
            // Shown in the week the break ends (its return day is usually the next Saturday).
            i.endDate >= win.start && i.endDate <= win.end
              ? `${b.name} returns to class on ${dayWd(back)}`
              : undefined,
        });
      }
    } else {
      const everyone = i.who === 'Everyone';
      const status = i.flags.length
        ? `classes off for ${everyone ? 'everyone' : i.who}, offices open`
        : `${everyone ? 'everyone' : i.who} off`;
      entries.push({
        category: i.category,
        text: `${i.title} · ${rangeWd(i.startDate, i.endDate)} · ${status}${i.expected ? ' · expected date' : ''}`,
      });
    }
  }
  return entries;
}

/** "14–20 Nov" or "28 Nov – 4 Dec" */
function weekShort(a: string, b: string): string {
  return a.slice(0, 7) === b.slice(0, 7)
    ? `${dom(a)}–${dom(b)} ${mon(b)}`
    : `${dom(a)} ${mon(a)} – ${dom(b)} ${mon(b)}`;
}

/** Per week: series counts per type (a series counts once per type), holiday titles. */
function summaryOf(r: HolidayReport): PdfModel['summary'] {
  const count = (items: ReportItem[], c: ReportCategory) => {
    const ids = new Set<number>();
    let events = 0;
    for (const i of items) {
      if (i.category !== c) continue;
      events++;
      for (const id of i.seriesIds ?? i.covered ?? []) ids.add(id);
    }
    return ids.size || events; // no series info: fall back to the number of items
  };
  const lines = r.weeks.map((w, k): PdfSummaryLine => {
    const parts: PdfSummaryLine['parts'] = [];
    for (const c of [
      'MID_BREAK',
      'SEMESTER_BREAK',
      'SUSPENDED_WEEK',
      'UNOFFICIAL_BREAK',
    ] as const) {
      const n = count(w.items, c);
      if (n > 0)
        parts.push({
          category: c,
          text: `${BREAK_NAME[c] ?? (c === 'SUSPENDED_WEEK' ? 'Class suspension' : 'Unofficial break')} ${n}`,
        });
    }
    const holidays = [
      ...new Set(w.items.filter((i) => i.category === 'HOLIDAY').map((i) => i.title)),
    ];
    if (holidays.length)
      parts.push({ category: 'HOLIDAY', text: `Holiday: ${holidays.join(', ')}` });
    return { week: `Week ${k + 1} · ${weekShort(w.start, w.end)}`, parts };
  });
  return { title: `Next 3 weeks · ${weekShort(r.from, r.to)}`, lines };
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
    summary: summaryOf(r),
    rows,
    types: (
      ['HOLIDAY', 'MID_BREAK', 'SEMESTER_BREAK', 'SUSPENDED_WEEK', 'UNOFFICIAL_BREAK'] as const
    ).filter((c) => seen.has(c)),
    weeks: r.weeks.map((w, k) => ({
      heading: `Week ${k + 1} · ${rangeWd(w.start, w.end)}`,
      entries: entriesOf(w.items, w, r.series, r.weeklyOffDays),
    })),
    weeklyOffDays: r.weeklyOffDays,
    weeklyOff: r.weeklyOff.join(' and '),
    noStatus: r.noStatus,
  };
}
