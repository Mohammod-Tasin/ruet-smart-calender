import { describe, expect, it } from 'vitest';
import {
  buildReport,
  describeSeries,
  type ReportInput,
  type ReportSeries,
} from '@/core/report/build';
import { reportWindows } from '@/core/report/windows';

describe('reportWindows', () => {
  it.each([
    [
      '2026-11-11',
      ['2026-11-11', '2026-11-18'],
      ['2026-11-19', '2026-11-25'],
      ['2026-11-26', '2026-12-02'],
    ],
    [
      '2026-12-27',
      ['2026-12-27', '2027-01-03'],
      ['2027-01-04', '2027-01-10'],
      ['2027-01-11', '2027-01-17'],
    ],
    [
      '2028-02-24',
      ['2028-02-24', '2028-03-02'],
      ['2028-03-03', '2028-03-09'],
      ['2028-03-10', '2028-03-16'],
    ],
  ])('from %s', (from, a, b, c) => {
    const w = reportWindows(from);
    expect(w.map((x) => [x.start, x.end])).toEqual([a, b, c]);
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

describe('buildReport', () => {
  it('has the glance rows and an empty week', () => {
    const r = buildReport(base);
    expect(r.to).toBe('2026-12-02');
    expect(r.weeks.every((w) => w.items.length === 0)).toBe(true);
    expect(r.glance).toHaveLength(5);
    expect(r.weeklyOff).toEqual(['Thursday', 'Friday']);
  });

  it('covers every category, flags, sorting and cross-week items', () => {
    const r = buildReport({
      ...base,
      noStatus: [3],
      holidays: [
        {
          id: 1,
          title: 'Victory Day',
          category: 'HOLIDAY',
          classesOnly: false,
          startDate: '2026-12-01',
          endDate: '2026-12-01',
          label: 'ALL',
          tentative: false,
        },
        {
          id: 2,
          title: 'Eid',
          category: 'HOLIDAY',
          classesOnly: true,
          startDate: '2026-11-17',
          endDate: '2026-11-20',
          label: 'Faculty of CE',
          tentative: true,
        },
        {
          id: 3,
          title: 'Suspended',
          category: 'SUSPENDED_WEEK',
          classesOnly: false,
          startDate: '2026-11-14',
          endDate: '2026-11-18',
          label: 'CSE',
          tentative: false,
        },
        {
          id: 4,
          title: 'Gap',
          category: 'UNOFFICIAL_BREAK',
          classesOnly: false,
          startDate: '2026-11-26',
          endDate: '2026-11-27',
          label: 'EEE',
          tentative: false,
        },
        {
          id: 5,
          title: 'ignored exam',
          category: 'EXAM',
          classesOnly: false,
          startDate: '2026-11-12',
          endDate: '2026-11-12',
          label: 'ALL',
          tentative: false,
        },
      ],
      breaks: [
        {
          category: 'MID_BREAK',
          startDate: '2026-11-19',
          endDate: '2026-11-27',
          seriesId: 1,
          semesterNo: 4,
        },
        {
          category: 'MID_BREAK',
          startDate: '2026-11-19',
          endDate: '2026-11-27',
          seriesId: 2,
          semesterNo: 4,
        },
        {
          category: 'SEMESTER_BREAK',
          startDate: '2026-11-12',
          endDate: '2026-11-20',
          seriesId: 4,
          semesterNo: 2,
        },
        {
          category: 'SEMESTER_BREAK',
          startDate: '2026-11-12',
          endDate: '2026-11-20',
          seriesId: 5,
          semesterNo: 2,
        },
        {
          category: 'SEMESTER_BREAK',
          startDate: '2026-11-12',
          endDate: '2026-11-20',
          seriesId: 6,
          semesterNo: 2,
        },
        {
          category: 'CLASS',
          startDate: '2026-11-12',
          endDate: '2026-11-13',
          seriesId: 1,
          semesterNo: 1,
        },
      ],
    });
    const titles = r.weeks.map((w) => w.items.map((i) => i.title));
    expect(titles[0]).toEqual(['Semester break', 'Suspended', 'Eid']);
    // Eid (17-20 Nov) crosses weeks 1 and 2; mid break 19-27 Nov crosses 2 and 3.
    expect(titles[1]).toEqual(['Semester break', 'Eid', 'Mid-term break']);
    expect(titles[2]).toEqual(['Mid-term break', 'Gap', 'Victory Day']);
    const eid = r.weeks[0]!.items.find((i) => i.title === 'Eid')!;
    expect([eid.startDate, eid.endDate, eid.expected, eid.flags]).toEqual([
      '2026-11-17',
      '2026-11-20',
      true,
      ['Classes off · offices open'],
    ]);
    expect(r.weeks[2]!.items.find((i) => i.title === 'Victory Day')!.who).toBe('Everyone');
    const sem = r.weeks[0]!.items[0]!;
    expect([sem.who, sem.semesters, sem.seriesCount, sem.inclWeekend]).toEqual([
      'All Batch 2024 departments',
      '1-2',
      3,
      true,
    ]);
    expect(r.weeks[1]!.items.find((i) => i.title === 'Mid-term break')!.who).toBe('CSE-23, EEE-23');
    expect(r.glance.map((g) => g.counts)).toEqual([
      [1, 1, 1],
      [1, 0, 0],
      [0, 0, 1],
      [0, 2, 2],
      [3, 3, 0],
    ]);
    expect(r.noStatus).toEqual(['ME-23']);
  });

  it('groups different ranges apart and joins semesters', () => {
    const r = buildReport({
      ...base,
      breaks: [
        {
          category: 'MID_BREAK',
          startDate: '2026-11-12',
          endDate: '2026-11-20',
          seriesId: 1,
          semesterNo: 4,
        },
        {
          category: 'MID_BREAK',
          startDate: '2026-11-12',
          endDate: '2026-11-20',
          seriesId: 4,
          semesterNo: 2,
        },
        {
          category: 'MID_BREAK',
          startDate: '2026-11-14',
          endDate: '2026-11-18',
          seriesId: 2,
          semesterNo: 4,
        },
      ],
    });
    const items = r.weeks[0]!.items;
    expect(items).toHaveLength(2);
    expect(items[0]!.semesters).toBe('1-2, 2-2');
    expect(items[1]!.inclWeekend).toBe(false);
  });
});
