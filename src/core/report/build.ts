import { addDays, weekdayOf } from '@/core/calendar/hijri';
import { reportWindows, type ReportWindow } from './windows';

export const REPORT_CATEGORIES = [
  'HOLIDAY',
  'SUSPENDED_WEEK',
  'UNOFFICIAL_BREAK',
  'MID_BREAK',
  'SEMESTER_BREAK',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** A day off from getOffDays() (one-off or yearly rule). Other categories are ignored. */
export interface ReportHoliday {
  id: number | string;
  title: string;
  category: string;
  classesOnly: boolean;
  startDate: string;
  endDate: string;
  /** Compressed audience label with faculty names ("ALL" = everyone). */
  label: string;
  tentative: boolean;
}

/** A per-series mid-term or semester break from the journey engine. */
export interface ReportBreak {
  category: string;
  startDate: string;
  endDate: string;
  seriesId: number;
  semesterNo: number;
}

export interface ReportSeries {
  id: number;
  label: string; // "CSE-23"
  departmentId: number;
  intakeYear: number;
}

export interface ReportItem {
  key: string;
  category: ReportCategory;
  title: string;
  startDate: string;
  endDate: string;
  /** Who is off: "Everyone", faculty/department labels, or series groups. */
  who: string;
  flags: string[];
  expected: boolean;
  /** The range includes weekly off days (Thu/Fri) at an edge: not extra break days. */
  inclWeekend: boolean;
  /** Breaks only: "2-2" or "2-2, 4-2". */
  semesters?: string;
  /** Breaks only: how many series. */
  seriesCount?: number;
}

export interface ReportWeek extends ReportWindow {
  items: ReportItem[];
}

export interface HolidayReport {
  from: string;
  to: string;
  weeks: [ReportWeek, ReportWeek, ReportWeek];
  /** Per category: count per week (items for holidays, series for breaks). */
  glance: { category: ReportCategory; counts: [number, number, number] }[];
  weeklyOff: string[]; // ["Thursday", "Friday"]
  noStatus: string[]; // series labels with no status
}

export interface ReportInput {
  from: string;
  holidays: ReportHoliday[];
  breaks: ReportBreak[];
  series: ReportSeries[]; // ACTIVE series only
  noStatus: number[]; // ids of series with no status
  weeklyOff: number[]; // JS weekdays
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const overlaps = (a: { startDate: string; endDate: string }, w: ReportWindow) =>
  a.startDate <= w.end && a.endDate >= w.start;

/** "All Batch 2024 departments", "CSE (all batches)", then single series. */
export function describeSeries(ids: number[], all: ReportSeries[]): string {
  const picked = new Set(ids);
  const mine = all.filter((s) => picked.has(s.id));
  if (mine.length === all.length && all.length > 0) return 'All departments, all batches';
  const parts: string[] = [];
  let rest = mine;
  const years = [...new Set(mine.map((s) => s.intakeYear))].sort((a, b) => b - a);
  for (const y of years) {
    const ofYear = all.filter((s) => s.intakeYear === y);
    if (ofYear.length > 1 && ofYear.every((s) => picked.has(s.id))) {
      parts.push(`All Batch ${y} departments`);
      rest = rest.filter((s) => s.intakeYear !== y);
    }
  }
  const depts = [...new Set(rest.map((s) => s.departmentId))];
  const restDone = new Set<number>();
  for (const d of depts) {
    const ofDept = all.filter((s) => s.departmentId === d);
    const code = ofDept[0]!.label.split('-')[0];
    if (ofDept.length > 1 && ofDept.every((s) => rest.includes(s))) {
      parts.push(`${code} (all batches)`);
      ofDept.forEach((s) => restDone.add(s.id));
    }
  }
  const single = rest
    .filter((s) => !restDone.has(s.id))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...parts, ...single.map((s) => s.label)].join(', ');
}

const semLabel = (n: number) => `${Math.ceil(n / 2)}-${n % 2 ? 1 : 2}`;

export function buildReport(input: ReportInput): HolidayReport {
  const windows = reportWindows(input.from);
  const flagged = new Set(input.weeklyOff);

  const holidayItems: ReportItem[] = input.holidays
    .filter((h) => (REPORT_CATEGORIES as readonly string[]).includes(h.category))
    .filter((h) => h.category !== 'MID_BREAK' && h.category !== 'SEMESTER_BREAK')
    .map((h) => ({
      key: `h:${h.id}`,
      category: h.category as ReportCategory,
      title: h.title,
      startDate: h.startDate,
      endDate: h.endDate,
      who: h.label === 'ALL' ? 'Everyone' : h.label,
      flags: h.classesOnly ? ['Classes off · offices open'] : [],
      expected: h.tentative,
      inclWeekend: false,
    }));

  // Breaks: group by category + exact range.
  const groups = new Map<string, ReportBreak[]>();
  for (const b of input.breaks) {
    if (b.category !== 'MID_BREAK' && b.category !== 'SEMESTER_BREAK') continue;
    const k = `${b.category}|${b.startDate}|${b.endDate}`;
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  const breakItems: ReportItem[] = [...groups].map(([k, list]) => {
    const first = list[0]!;
    const ids = [...new Set(list.map((b) => b.seriesId))];
    const sems = [...new Set(list.map((b) => b.semesterNo))].sort((a, b) => a - b);
    return {
      key: `b:${k}`,
      category: first.category as ReportCategory,
      title: first.category === 'MID_BREAK' ? 'Mid-term break' : 'Semester break',
      startDate: first.startDate,
      endDate: first.endDate,
      who: describeSeries(ids, input.series),
      flags: [],
      expected: false,
      inclWeekend: flagged.has(weekdayOf(first.startDate)) || flagged.has(weekdayOf(first.endDate)),
      semesters: sems.map(semLabel).join(', '),
      seriesCount: ids.length,
    };
  });

  const all = [...holidayItems, ...breakItems];
  const weeks = windows.map((w) => ({
    ...w,
    items: all
      .filter((i) => overlaps(i, w))
      .sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          a.category.localeCompare(b.category) ||
          a.title.localeCompare(b.title),
      ),
  })) as HolidayReport['weeks'];

  const glance = REPORT_CATEGORIES.map((category) => ({
    category,
    counts: weeks.map((w) =>
      w.items.filter((i) => i.category === category).reduce((n, i) => n + (i.seriesCount ?? 1), 0),
    ) as [number, number, number],
  }));

  const byId = new Map(input.series.map((s) => [s.id, s.label]));
  return {
    from: input.from,
    to: addDays(input.from, 21),
    weeks,
    glance,
    weeklyOff: [...input.weeklyOff].sort().map((d) => DAY_NAMES[d]!),
    noStatus: input.noStatus
      .map((id) => byId.get(id))
      .filter((x): x is string => !!x)
      .sort(),
  };
}
