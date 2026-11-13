import { describe, expect, it } from 'vitest';
import {
  buildReport,
  describeSeries,
  type ReportInput,
  type ReportSeries,
} from '@/core/report/build';
import { addDays, weekdayOf } from '@/core/calendar/hijri';
import { monthWindows, reportWindows } from '@/core/report/windows';

describe('monthWindows', () => {
  it('partitions November 2026 into 5 academic weeks ending on the last week Friday Dec 4', () => {
    const w = monthWindows('2026-11');
    expect(w).toEqual([
      { start: '2026-11-01', end: '2026-11-06' },
      { start: '2026-11-07', end: '2026-11-13' },
      { start: '2026-11-14', end: '2026-11-20' },
      { start: '2026-11-21', end: '2026-11-27' },
      { start: '2026-11-28', end: '2026-12-04' },
    ]);
  });

  it('partitions from download date (e.g. 13 Nov) to the end of the month last week (4 Dec)', () => {
    const w = monthWindows('2026-11', '2026-11-13');
    expect(w).toEqual([
      { start: '2026-11-13', end: '2026-11-13' },
      { start: '2026-11-14', end: '2026-11-20' },
      { start: '2026-11-21', end: '2026-11-27' },
      { start: '2026-11-28', end: '2026-12-04' },
    ]);
  });

  it('partitions August 2026 where day 1 is a Saturday through the end of the last week (Sep 4)', () => {
    const w = monthWindows('2026-08');
    expect(w[0]).toEqual({ start: '2026-08-01', end: '2026-08-07' });
    expect(w.at(-1)).toEqual({ start: '2026-08-29', end: '2026-09-04' });
  });

  it('handles leap year February 2028 through Friday Mar 3', () => {
    const w = monthWindows('2028-02');
    expect(w[0]!.start).toBe('2028-02-01');
    expect(w.at(-1)!.end).toBe('2028-03-03');
  });
});

describe('reportWindows', () => {
  it.each([
    ['2026-11-11', '2026-11-14', '2026-12-04'], // Wednesday
    ['2026-11-14', '2026-11-21', '2026-12-11'], // Saturday -> the NEXT Saturday
    ['2026-11-13', '2026-11-14', '2026-12-04'], // Friday
    ['2026-11-15', '2026-11-21', '2026-12-11'], // Sunday
    ['2026-12-27', '2027-01-02', '2027-01-22'], // year rollover
    ['2028-02-24', '2028-02-26', '2028-03-17'], // leap year
  ])('from %s: first %s, last day %s', (from, first, last) => {
    const w = reportWindows(from);
    expect(w[0].start).toBe(first);
    expect(w[2].end).toBe(last);
    for (const [k, x] of w.entries()) {
      expect(weekdayOf(x.start)).toBe(6); // Saturday
      expect(weekdayOf(x.end)).toBe(5); // Friday
      expect(x.start).toBe(addDays(w[0].start, 7 * k));
    }
    expect(w[0].start > from).toBe(true); // the present week is never included
    expect(addDays(from, 7) >= w[0].start).toBe(true); // ...and week 1 is the very next one
  });

  it('every weekday of a week gives the same windows, the next Saturday starts a new one', () => {
    const sat = '2026-11-07';
    const first = reportWindows(addDays(sat, 1))[0].start; // Sunday 8 Nov -> Sat 14 Nov
    expect(weekdayOf(first)).toBe(6);
    for (let k = 1; k <= 6; k++) expect(reportWindows(addDays(sat, k))[0].start).toBe(first);
    expect(reportWindows(first)[0].start).toBe(addDays(first, 7));
  });
});

const mk = (id: number, dept: number, code: string, year: number): ReportSeries => ({
  id,
  label: `${code}-${year % 100}`,
  departmentId: dept,
  intakeYear: year,
});
// CSE, EEE, ME x 2023, 2024
const series = [
  mk(1, 1, 'CSE', 2023),
  mk(2, 2, 'EEE', 2023),
  mk(3, 3, 'ME', 2023),
  mk(4, 1, 'CSE', 2024),
  mk(5, 2, 'EEE', 2024),
  mk(6, 3, 'ME', 2024),
];

describe('describeSeries', () => {
  it.each([
    [[1, 2, 3, 4, 5, 6], 'All departments, all batches'],
    [[4, 5, 6], 'All Batch 2024 departments'],
    [[1, 4], 'CSE (all batches)'],
    [[1, 5], 'CSE-23, EEE-24'],
    [[4, 5, 6, 1], 'All Batch 2024 departments, CSE-23'],
  ])('%j', (ids, text) => expect(describeSeries(ids, series)).toBe(text));
});

const base: ReportInput = {
  from: '2026-11-11',
  holidays: [],
  breaks: [],
  series,
  noStatus: [],
  weeklyOff: [4, 5],
};

const hol = (
  id: number,
  title: string,
  category: string,
  startDate: string,
  endDate: string,
  label: string,
  extra: { classesOnly?: boolean; tentative?: boolean } = {},
) => ({
  id,
  title,
  category,
  startDate,
  endDate,
  label,
  classesOnly: false,
  tentative: false,
  ...extra,
});
const brk = (
  category: string,
  startDate: string,
  endDate: string,
  seriesId: number,
  semesterNo: number,
) => ({
  category,
  startDate,
  endDate,
  seriesId,
  semesterNo,
});

// D = Wed 11 Nov 2026 -> weeks 14-20 Nov, 21-27 Nov, 28 Nov - 4 Dec.
describe('buildReport', () => {
  it('has the glance rows and an empty report', () => {
    const r = buildReport(base);
    expect([r.from, r.to]).toEqual(['2026-11-14', '2026-12-04']);
    expect(r.weeks.map((w) => [w.start, w.end])).toEqual([
      ['2026-11-14', '2026-11-20'],
      ['2026-11-21', '2026-11-27'],
      ['2026-11-28', '2026-12-04'],
    ]);
    expect(r.weeks.every((w) => w.items.length === 0)).toBe(true);
    expect(r.glance).toHaveLength(5);
    expect(r.weeklyOff).toEqual(['Thursday', 'Friday']);
  });

  it('covers every category, flags, sorting and cross-week items', () => {
    const r = buildReport({
      ...base,
      noStatus: [3],
      holidays: [
        hol(1, 'Victory Day', 'HOLIDAY', '2026-12-01', '2026-12-01', 'ALL'),
        hol(2, 'Eid', 'HOLIDAY', '2026-11-17', '2026-11-20', 'Faculty of CE', {
          classesOnly: true,
          tentative: true,
        }),
        hol(3, 'Suspended', 'SUSPENDED_WEEK', '2026-11-14', '2026-11-18', 'CSE'),
        hol(4, 'Gap', 'UNOFFICIAL_BREAK', '2026-11-26', '2026-11-27', 'EEE'),
        hol(5, 'ignored exam', 'EXAM', '2026-11-15', '2026-11-15', 'ALL'),
        hol(6, 'before the report', 'HOLIDAY', '2026-11-12', '2026-11-13', 'ALL'),
      ],
      breaks: [
        brk('SEMESTER_BREAK', '2026-11-13', '2026-11-20', 4, 2),
        brk('SEMESTER_BREAK', '2026-11-13', '2026-11-20', 5, 2),
        brk('SEMESTER_BREAK', '2026-11-13', '2026-11-20', 6, 2),
        brk('MID_BREAK', '2026-11-19', '2026-11-27', 1, 4),
        brk('MID_BREAK', '2026-11-19', '2026-11-27', 2, 4),
        brk('CLASS', '2026-11-15', '2026-11-16', 1, 1),
      ],
    });
    const titles = r.weeks.map((w) => w.items.map((i) => i.title));
    expect(titles[0]).toEqual(['Semester break', 'Suspended', 'Eid', 'Mid-term break']);
    expect(titles[1]).toEqual(['Mid-term break', 'Gap']); // mid-term break crosses weeks 1 and 2
    expect(titles[2]).toEqual(['Victory Day']);
    const eid = r.weeks[0]!.items.find((i) => i.title === 'Eid')!;
    expect([eid.startDate, eid.endDate, eid.expected, eid.flags]).toEqual([
      '2026-11-17',
      '2026-11-20',
      true,
      ['Classes off · offices open'],
    ]);
    expect(r.weeks[2]!.items[0]!.who).toBe('Everyone');
    const sem = r.weeks[0]!.items[0]!;
    expect([sem.who, sem.semesters, sem.seriesCount, sem.inclWeekend]).toEqual([
      'All Batch 2024 departments',
      '1-2',
      3,
      true,
    ]);
    expect(r.weeks[1]!.items[0]!.who).toBe('CSE-23, EEE-23');
    expect(r.glance.map((g) => g.counts)).toEqual([
      [1, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
      [2, 2, 0],
      [3, 0, 0],
    ]);
    expect(r.noStatus).toEqual(['ME-23']);
  });

  it('groups different ranges apart and joins semesters', () => {
    const r = buildReport({
      ...base,
      breaks: [
        brk('MID_BREAK', '2026-11-14', '2026-11-20', 1, 4),
        brk('MID_BREAK', '2026-11-14', '2026-11-20', 4, 2),
        brk('MID_BREAK', '2026-11-15', '2026-11-18', 2, 4),
      ],
    });
    const items = r.weeks[0]!.items;
    expect(items).toHaveLength(2);
    expect(items[0]!.semesters).toBe('1-2, 2-2');
    expect(items[1]!.inclWeekend).toBe(false);
  });

  it('builds a monthly report from download date to the end of the month last week', () => {
    const r = buildReport({
      ...base,
      month: '2026-11',
      downloadedAt: '2026-11-13',
    });
    expect(r.monthTitle).toBe('November 2026');
    expect(r.from).toBe('2026-11-13');
    expect(r.to).toBe('2026-12-04');
    expect(r.downloadedAt).toBe('2026-11-13');
    expect(r.weeks).toHaveLength(4);
    expect(r.weeks[0]!.start).toBe('2026-11-13');
    expect(r.weeks[3]!.end).toBe('2026-12-04');
  });

  it('builds a full monthly report when from is month key or day 1', () => {
    const r = buildReport({
      ...base,
      from: '2026-11',
      month: '2026-11',
    });
    expect(r.monthTitle).toBe('November 2026');
    expect(r.from).toBe('2026-11-01');
    expect(r.to).toBe('2026-12-04');
    expect(r.weeks).toHaveLength(5);
    expect(r.weeks[0]!.start).toBe('2026-11-01');
    expect(r.weeks[4]!.end).toBe('2026-12-04');
  });
});
