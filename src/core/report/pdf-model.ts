import { addDays, weekdayOf } from '@/core/calendar/hijri';
import { MONTHS_SHORT } from '@/core/calendar/months';
import {
  REPORT_CATEGORIES,
  type HolidayReport,
  type ReportCategory,
  type ReportItem,
  type ReportSeries,
} from './build';

// The data behind the PDF: a per-week summary of who is off, then plain sentences per week.
// Pure; the React layout only draws it.

export interface PdfEntry {
  category: ReportCategory;
  text: string;
  /** Second line, e.g. the departments of a batch. */
  sub?: string;
  /** Third line: "Batch 2024 returns to class on Sat 21 Nov". */
  resume?: string;
}
export interface PdfSummaryPart {
  date: string; // "Fri 13–20 Nov" or "Tue 1 Dec"
  category: ReportCategory;
  label: string;
  who: string;
  studentCount: number;
  boysCount: number;
  femaleCount: number;
  brothersCount: number;
}
export interface PdfSummaryLine {
  week: string; // "Week 1 · Sat 14–20 Nov"
  totalBoysCount: number;
  totalStudentCount: number;
  totalBrothersCount: number;
  parts: PdfSummaryPart[];
}
export interface PdfStatusEntry {
  key: string;
  label: string;
  count: number;
}

export interface PdfModel {
  title: string;
  reportDate?: string;
  downloadedAt?: string;
  statusSummary?: PdfStatusEntry[];
  summary: PdfSummaryLine[];
  weeks: { heading: string; entries: PdfEntry[] }[];
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

/** First day after `end` that is not a weekly holiday. */
function firstDayBack(end: string, off: number[]): string {
  let d = addDays(end, 1);
  while (off.includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
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

/** "Fri 13–20 Nov", "Tue 1 Dec", or "Sat 28 Nov – 4 Dec" */
export function shortRangeWd(a: string, b: string): string {
  const wd = WD[weekdayOf(a)];
  if (a === b) return `${wd} ${dom(a)} ${mon(a)}`;
  return a.slice(0, 7) === b.slice(0, 7)
    ? `${wd} ${dom(a)}–${dom(b)} ${mon(b)}`
    : `${wd} ${dom(a)} ${mon(a)} – ${dom(b)} ${mon(b)}`;
}

/** "Sat 14–20 Nov", "Fri 13–13 Nov", or "Sat 28 Nov – 4 Dec" */
export function weekShort(a: string, b: string): string {
  const wd = WD[weekdayOf(a)];
  return a.slice(0, 7) === b.slice(0, 7)
    ? `${wd} ${dom(a)}–${dom(b)} ${mon(b)}`
    : `${wd} ${dom(a)} ${mon(a)} – ${dom(b)} ${mon(b)}`;
}

/** "Batch 2021 (ARCH, BECM), CME-22": by batch (oldest first), departments A-Z, a lone series by name. */
export function whoText(ids: number[], series: ReportSeries[]): string {
  if (ids.length > 0 && series.every((s) => ids.includes(s.id))) return 'Everyone';
  return groupByBatch(ids, series)
    .sort((a, b) => a.year - b.year)
    .map((b) =>
      b.single
        ? b.name
        : `${b.name} (${[...b.codes].sort((x, y) => x.localeCompare(y)).join(', ')})`,
    )
    .join(', ');
}

/** Per week: list each holiday/break with its start date and day, type, and affected departments. */
function summaryOf(r: HolidayReport): PdfSummaryLine[] {
  const femalePct = r.femaleStudentPercentage ?? 15;
  const seriesMap = new Map(r.series.map((s) => [s.id, s]));
  const totalActiveStudents = r.series.reduce((sum, s) => sum + (s.studentCount ?? 60), 0);
  const totalActiveBrothers = r.series.reduce((sum, s) => sum + (s.brothersCount ?? 0), 0);

  return r.weeks.map((w, k): PdfSummaryLine => {
    const groups = new Map<
      string,
      {
        startDate: string;
        endDate: string;
        category: ReportCategory;
        label: string;
        title: string;
        ids: number[];
        whoSet: Set<string>;
      }
    >();

    for (const item of w.items) {
      if ((REPORT_CATEGORIES as readonly string[]).includes(item.category)) {
        const cat = item.category as ReportCategory;
        const label =
          BREAK_NAME[cat] ??
          (cat === 'SUSPENDED_WEEK'
            ? 'Class suspension'
            : cat === 'UNOFFICIAL_BREAK'
              ? 'Unofficial break'
              : cat === 'HOLIDAY'
                ? 'Holiday'
                : cat);
        const title = cat === 'HOLIDAY' ? item.title : '';
        const key = `${item.startDate}|${item.endDate}|${cat}|${title}`;
        let g = groups.get(key);
        if (!g) {
          g = {
            startDate: item.startDate,
            endDate: item.endDate,
            category: cat,
            label,
            title,
            ids: [],
            whoSet: new Set<string>(),
          };
          groups.set(key, g);
        }
        if (item.seriesIds) g.ids.push(...item.seriesIds);
        if (item.covered) g.ids.push(...item.covered);
        if (item.who) {
          g.whoSet.add(item.who);
        }
      }
    }

    const sortedGroups = [...groups.values()].sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        a.endDate.localeCompare(b.endDate) ||
        a.category.localeCompare(b.category),
    );

    const parts: PdfSummaryPart[] = sortedGroups.map((g) => {
      const uniqueIds = [...new Set(g.ids)];
      const baseWho =
        uniqueIds.length > 0
          ? whoText(uniqueIds, r.series)
          : [...g.whoSet].join(', ');
      const who =
        g.category === 'HOLIDAY' && g.title ? `${g.title} (${baseWho})` : baseWho;

      let studentCount = 0;
      if (uniqueIds.length > 0) {
        studentCount = uniqueIds.reduce((sum, id) => {
          const s = seriesMap.get(id);
          return sum + (s?.studentCount ?? 60);
        }, 0);
      } else if (baseWho === 'Everyone' || g.whoSet.has('Everyone') || g.whoSet.has('ALL')) {
        studentCount = totalActiveStudents;
      }
      const femaleCount = Math.round((studentCount * femalePct) / 100);
      const boysCount = Math.max(0, studentCount - femaleCount);

      let brothersCount = 0;
      if (uniqueIds.length > 0) {
        brothersCount = uniqueIds.reduce((sum, id) => {
          const s = seriesMap.get(id);
          return sum + (s?.brothersCount ?? 0);
        }, 0);
      } else if (baseWho === 'Everyone' || g.whoSet.has('Everyone') || g.whoSet.has('ALL')) {
        brothersCount = totalActiveBrothers;
      }

      return {
        date: shortRangeWd(g.startDate, g.endDate),
        category: g.category,
        label: g.label,
        who,
        studentCount,
        boysCount,
        femaleCount,
        brothersCount,
      };
    });

    const weekSeriesIds = new Set<number>();
    let everyoneInWeek = false;
    for (const g of sortedGroups) {
      g.ids.forEach((id) => weekSeriesIds.add(id));
      if (g.whoSet.has('Everyone') || g.whoSet.has('ALL')) {
        everyoneInWeek = true;
      }
    }
    let totalStudentCount = 0;
    if (everyoneInWeek) {
      totalStudentCount = totalActiveStudents;
    } else if (weekSeriesIds.size > 0) {
      totalStudentCount = [...weekSeriesIds].reduce((sum, id) => {
        const s = seriesMap.get(id);
        return sum + (s?.studentCount ?? 60);
      }, 0);
    }
    const totalFemaleCount = Math.round((totalStudentCount * femalePct) / 100);
    const totalBoysCount = Math.max(0, totalStudentCount - totalFemaleCount);

    let totalBrothersCount = 0;
    if (everyoneInWeek) {
      totalBrothersCount = totalActiveBrothers;
    } else if (weekSeriesIds.size > 0) {
      totalBrothersCount = [...weekSeriesIds].reduce((sum, id) => {
        const s = seriesMap.get(id);
        return sum + (s?.brothersCount ?? 0);
      }, 0);
    }

    return {
      week: `Week ${k + 1} · ${weekShort(w.start, w.end)}`,
      totalBoysCount,
      totalStudentCount,
      totalBrothersCount,
      parts,
    };
  });
}

const STATUS_SUMMARY_ITEMS: [string, string][] = [
  ['CLASS', 'Class'],
  ['MID_BREAK', 'Mid-term break'],
  ['VIVA', 'Board Viva'],
  ['EXAM', 'Final'],
  ['SEMESTER_BREAK', 'Semester break'],
];

function statusSummaryOf(r: HolidayReport): PdfStatusEntry[] {
  if (!r.statusSummary) return [];
  const entries: PdfStatusEntry[] = [];
  for (const [key, label] of STATUS_SUMMARY_ITEMS) {
    const count = r.statusSummary[key];
    if (count !== undefined && count > 0) {
      entries.push({ key, label, count });
    }
  }
  return entries;
}

export function buildPdfModel(r: HolidayReport): PdfModel {
  const title = r.monthTitle || longRange(r.from, r.to);
  return {
    title,
    reportDate: r.from,
    downloadedAt: r.downloadedAt,
    statusSummary: statusSummaryOf(r),
    summary: summaryOf(r),
    weeks: r.weeks.map((w, k) => ({
      heading: `Week ${k + 1} · ${rangeWd(w.start, w.end)}`,
      entries: entriesOf(w.items, w, r.series, r.weeklyOffDays),
    })),
    noStatus: r.noStatus,
  };
}
