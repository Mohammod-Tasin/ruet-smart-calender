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
    seriesIds: number[],
    extra: { classesOnly?: boolean; tentative?: boolean } = {},
  ) => ({
    id,
    title,
    category,
    startDate,
    endDate,
    label,
    seriesIds,
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
  const r = buildReport({
    ...base,
    holidays: [
      hol(1, 'Victory Day', 'HOLIDAY', '2026-12-01', '2026-12-01', 'ALL', [1, 2, 4, 5, 6]),
      hol(2, 'Gap', 'UNOFFICIAL_BREAK', '2026-11-26', '2026-11-27', 'CSE', [1, 4], {
        classesOnly: true,
        tentative: true,
      }),
      hol(3, 'Short', 'SUSPENDED_WEEK', '2026-11-22', '2026-11-25', 'EEE', [2, 5]),
    ],
    breaks: [
      brk('SEMESTER_BREAK', '2026-11-13', '2026-11-20', 4, 2),
      brk('SEMESTER_BREAK', '2026-11-13', '2026-11-20', 5, 2),
      brk('SEMESTER_BREAK', '2026-11-13', '2026-11-20', 6, 2),
      brk('MID_BREAK', '2026-11-19', '2026-11-27', 1, 4),
      brk('MID_BREAK', '2026-11-19', '2026-11-27', 4, 2),
    ],
  });
  const m = buildPdfModel(r);

  it('has the title and exactly 3 Saturday-Friday rows', () => {
    expect(m.title).toBe('RUET Holidays & Breaks · 14 Nov – 4 Dec 2026');
    expect(m.rows).toHaveLength(3);
    expect(m.rows[0]!.dates[0]).toBe('2026-11-14');
    expect(m.rows[2]!.dates[6]).toBe('2026-12-04');
    for (const row of m.rows) expect(weekdayOf(row.dates[0]!)).toBe(6);
  });

  it('bar labels are "<who> · <type>" with a shorter fallback', () => {
    const bars = m.rows.flatMap((x) => x.bars.map((b) => b.item));
    const by = (text: string) => bars.find((b) => b.text === text);
    expect(by('Batch 2024 · CSE, EEE, ME · Semester break')!.alt).toBe(
      'Batch 2024 · Semester break',
    );
    expect(by('CSE-23 · Mid-term break')!.alt).toBeUndefined(); // a single series has nothing to drop
    expect(by('CSE-24 · Mid-term break')).toBeDefined();
    expect(by('Everyone · Victory Day')!.alt).toBe('Victory Day');
    expect(by('CSE · Gap')).toBeDefined();
    expect(by('EEE · Short')).toBeDefined();
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

  it('summary counts series per type per week, holidays by title, empty weeks say so', () => {
    expect(m.summary.title).toBe('Next 3 weeks · 14 Nov – 4 Dec');
    expect(m.summary.lines.map((l) => [l.week, l.parts.map((p) => p.text)])).toEqual([
      ['Week 1 · 14–20 Nov', ['Mid-term break 2', 'Semester break 3']],
      ['Week 2 · 21–27 Nov', ['Mid-term break 2', 'Class suspension 2', 'Unofficial break 2']],
      ['Week 3 · 28 Nov – 4 Dec', ['Holiday: Victory Day']],
    ]);
    const e = buildPdfModel(buildReport(base));
    expect(e.summary.lines.every((l) => l.parts.length === 0)).toBe(true);
  });

  it('writes one plain sentence per break per week, with departments and the return day', () => {
    expect(m.weeks.map((w) => w.heading)).toEqual([
      'Week 1 · Sat 14 – Fri 20 Nov',
      'Week 2 · Sat 21 – Fri 27 Nov',
      'Week 3 · Sat 28 Nov – Fri 4 Dec',
    ]);
    const w1 = m.weeks[0]!.entries;
    expect(w1[0]).toMatchObject({
      category: 'SEMESTER_BREAK',
      text: 'Batch 2024 is on semester break until Fri 20 Nov',
      sub: 'CSE, EEE, ME',
      resume: 'Batch 2024 returns to class on Sat 21 Nov',
    });
    expect(w1[1]).toMatchObject({
      text: 'CSE-24 has mid-term break, Thu 19 – Fri 27 Nov', // newest batch first
      sub: undefined,
    });
    expect(w1[2]!.text).toBe('CSE-23 has mid-term break, Thu 19 – Fri 27 Nov');
    expect(w1[1]!.resume).toBeUndefined(); // ends in week 2
    const w2 = m.weeks[1]!.entries.map((e) => e.text);
    expect(w2).toContain('CSE-23 is on mid-term break until Fri 27 Nov');
    expect(m.weeks[1]!.entries.find((e) => e.text.startsWith('CSE-23'))!.resume).toBe(
      'CSE-23 returns to class on Sat 28 Nov',
    );
    expect(w2).toContain('Short · Sun 22 – Wed 25 Nov · EEE off');
    expect(w2).toContain(
      'Gap · Thu 26 – Fri 27 Nov · classes off for CSE, offices open · expected date',
    );
    expect(m.weeks[2]!.entries.map((e) => e.text)).toEqual([
      'Victory Day · Tue 1 Dec · everyone off',
    ]);
  });

  it('an empty report has no entries, no bars and no legend types', () => {
    const e = buildPdfModel(buildReport(base));
    expect(e.weeks.every((w) => w.entries.length === 0)).toBe(true);
    expect(e.types).toEqual([]);
    expect(e.rows.every((x) => x.bars.length === 0)).toBe(true);
  });
});
