import { describe, expect, it } from 'vitest';
import { weekdayOf } from '@/core/calendar/hijri';
import { buildReport, type ReportInput, type ReportSeries } from '@/core/report/build';
import { buildPdfModel, dayWd, groupByBatch, longRange, rangeWd } from '@/core/report/pdf-model';

const mk = (id: number, dept: number, code: string, year: number): ReportSeries => ({
  id,
  label: `${code}-${year % 100}`,
  departmentId: dept,
  intakeYear: year,
});
const series = [
  mk(1, 1, 'CSE', 2023),
  mk(2, 2, 'EEE', 2023),
  mk(4, 1, 'CSE', 2024),
  mk(5, 2, 'EEE', 2024),
  mk(6, 3, 'ME', 2024),
];
const base: ReportInput = {
  from: '2026-11-11',
  holidays: [],
  breaks: [],
  series,
  noStatus: [],
  weeklyOff: [4, 5],
};

describe('formatting', () => {
  it('formats ranges', () => {
    expect(longRange('2026-11-11', '2026-12-02')).toBe('11 Nov – 2 Dec 2026');
    expect(longRange('2026-12-28', '2027-01-17')).toBe('28 Dec 2026 – 17 Jan 2027');
    expect(dayWd('2026-12-16')).toBe('Wed 16 Dec');
    expect(rangeWd('2026-11-12', '2026-11-20')).toBe('Thu 12 – Fri 20 Nov');
    expect(rangeWd('2026-11-28', '2026-12-04')).toBe('Sat 28 Nov – Fri 4 Dec');
    expect(rangeWd('2026-12-16', '2026-12-16')).toBe('Wed 16 Dec');
  });
});

describe('groupByBatch', () => {
  it('groups by year, newest first, single keeps its name', () => {
    const g = groupByBatch([1, 2, 4, 5, 6], series);
    expect(g.map((b) => [b.name, b.codes])).toEqual([
      ['Batch 2024', ['CSE', 'EEE', 'ME']],
      ['Batch 2023', ['CSE', 'EEE']],
    ]);
    expect(groupByBatch([2], series)[0]).toMatchObject({ name: 'EEE-23', single: true });
  });
});

describe('buildPdfModel', () => {
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
    c: string,
    startDate: string,
    endDate: string,
    seriesId: number,
    semesterNo: number,
  ) => ({
    category: c,
    startDate,
    endDate,
    seriesId,
    semesterNo,
  });
  // D = Wed 11 Nov 2026 -> report weeks 14-20 Nov, 21-27 Nov, 28 Nov - 4 Dec
  const m = buildPdfModel(
    buildReport({
      ...base,
      noStatus: [2],
      holidays: [
        hol(1, 'Victory Day', 'HOLIDAY', '2026-12-01', '2026-12-01', 'ALL'),
        hol(2, 'Gap', 'UNOFFICIAL_BREAK', '2026-11-26', '2026-11-27', 'CSE', {
          classesOnly: true,
          tentative: true,
        }),
        hol(3, 'Short', 'SUSPENDED_WEEK', '2026-11-22', '2026-11-25', 'EEE'),
      ],
      breaks: [
        brk('SEMESTER_BREAK', '2026-11-13', '2026-11-20', 4, 2),
        brk('SEMESTER_BREAK', '2026-11-13', '2026-11-20', 5, 2),
        brk('SEMESTER_BREAK', '2026-11-13', '2026-11-20', 6, 2),
        brk('MID_BREAK', '2026-11-19', '2026-11-27', 1, 4),
        brk('MID_BREAK', '2026-11-19', '2026-11-27', 4, 2),
      ],
    }),
  );

  it('has the title and exactly 3 Saturday-Friday rows', () => {
    expect(m.title).toBe('RUET Holidays & Breaks · 14 Nov – 4 Dec 2026');
    expect(m.rows).toHaveLength(3);
    expect(m.rows[0]!.dates[0]).toBe('2026-11-14');
    expect(m.rows[2]!.dates[6]).toBe('2026-12-04');
    for (const row of m.rows) expect(weekdayOf(row.dates[0]!)).toBe(6);
  });

  it('bar labels say who only, batches list department names', () => {
    const texts = m.rows.flatMap((x) => x.bars.map((b) => b.item.text));
    expect(texts).toContain('Batch 2024 · CSE, EEE, ME');
    expect(texts).toContain('CSE-23');
    expect(texts).toContain('CSE-24');
    expect(texts).toContain('Victory Day');
    expect(texts).toContain('CSE'); // unofficial break: who only
    expect(texts).toContain('EEE'); // suspension: who only
    expect(texts.some((t) => /departments|break/i.test(t))).toBe(false);
    // a bar crossing two rows appears once per row, a single-row one once
    expect(texts.filter((t) => t === 'Batch 2024 · CSE, EEE, ME')).toHaveLength(1);
  });

  it('legend lists only the types that appear', () => {
    expect(m.types).toEqual([
      'HOLIDAY',
      'MID_BREAK',
      'SEMESTER_BREAK',
      'SUSPENDED_WEEK',
      'UNOFFICIAL_BREAK',
    ]);
    const e = buildPdfModel(
      buildReport({ ...base, breaks: [brk('MID_BREAK', '2026-11-19', '2026-11-20', 1, 4)] }),
    );
    expect(e.types).toEqual(['MID_BREAK']);
  });

  it('table lists each break once, sorted by start date, with the first day back', () => {
    expect(m.table.map((t) => [t.who, t.type, t.off, t.back])).toEqual([
      ['Batch 2024 · CSE, EEE, ME', 'Semester break', 'until Fri 20 Nov', 'Sat 21 Nov'],
      ['CSE-23', 'Mid-term break', 'Thu 19 – Fri 27 Nov', 'Sat 28 Nov'],
      ['CSE-24', 'Mid-term break', 'Thu 19 – Fri 27 Nov', 'Sat 28 Nov'],
      ['EEE', 'Short', 'Sun 22 – Wed 25 Nov', 'Sat 28 Nov'], // Thu and Fri are weekly holidays
      ['CSE', 'Gap', 'Thu 26 – Fri 27 Nov · expected', 'Sat 28 Nov'],
      ['Everyone', 'Victory Day', 'Tue 1 Dec', '–'],
    ]);
    expect(m.table.find((t) => t.type === 'Gap')!.note).toBe('Classes off · offices open');
    expect(new Set(m.table.map((t) => t.key)).size).toBe(m.table.length);
  });

  it('an empty report has no table rows, no bars and no legend types', () => {
    const e = buildPdfModel(buildReport(base));
    expect(e.table).toEqual([]);
    expect(e.types).toEqual([]);
    expect(e.rows.every((x) => x.bars.length === 0)).toBe(true);
  });
});
