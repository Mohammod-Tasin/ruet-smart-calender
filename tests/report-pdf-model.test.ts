import { describe, expect, it } from 'vitest';
import { buildReport, type ReportInput, type ReportSeries } from '@/core/report/build';
import {
  buildPdfModel,
  dayWd,
  groupByBatch,
  longRange,
  rangeWd,
  weekShort,
  whoText,
} from '@/core/report/pdf-model';

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
    expect(weekShort('2026-11-13', '2026-11-13')).toBe('Fri 13–13 Nov');
    expect(weekShort('2026-11-14', '2026-11-20')).toBe('Sat 14–20 Nov');
    expect(weekShort('2026-11-28', '2026-12-04')).toBe('Sat 28 Nov – 4 Dec');
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

  it('has the title', () => {
    expect(m.title).toBe('14 Nov – 4 Dec 2026');
  });

  it('uses monthly report title and retains downloadedAt when specified', () => {
    const monthly = buildPdfModel({
      ...r,
      monthTitle: 'November 2026',
      downloadedAt: '2026-11-13',
      statusSummary: {
        CLASS: 31,
        MID_BREAK: 1,
        VIVA: 2,
        EXAM: 11,
        SEMESTER_BREAK: 13,
      },
    });
    expect(monthly.title).toBe('November 2026');
    expect(monthly.reportDate).toBe(r.from);
    expect(monthly.downloadedAt).toBe('2026-11-13');
    expect(monthly.statusSummary).toEqual([
      { key: 'CLASS', label: 'Class', count: 31 },
      { key: 'MID_BREAK', label: 'Mid-term break', count: 1 },
      { key: 'VIVA', label: 'Board Viva', count: 2 },
      { key: 'EXAM', label: 'Final', count: 11 },
      { key: 'SEMESTER_BREAK', label: 'Semester break', count: 13 },
    ]);
  });

  it('summary lists who is off per week and type, with dates', () => {
    expect(m.summary.map((l) => [l.week, l.parts.map((p) => [p.date, p.label, p.who])])).toEqual([
      [
        'Week 1 · Sat 14–20 Nov',
        [
          ['Fri 13–20 Nov', 'Semester break', 'Batch 2024 (CSE, EEE, ME)'],
          ['Thu 19–27 Nov', 'Mid-term break', 'CSE-23, CSE-24'],
        ],
      ],
      [
        'Week 2 · Sat 21–27 Nov',
        [
          ['Thu 19–27 Nov', 'Mid-term break', 'CSE-23, CSE-24'],
          ['Sun 22–25 Nov', 'Class suspension', 'EEE-23, EEE-24'],
          ['Thu 26–27 Nov', 'Unofficial break', 'CSE-23, CSE-24'],
        ],
      ],
      ['Week 3 · Sat 28 Nov – 4 Dec', [['Tue 1 Dec', 'Holiday', 'Victory Day (Everyone)']]],
    ]);
    expect(m.summary[0]!.parts.map((p) => p.category)).toEqual(['SEMESTER_BREAK', 'MID_BREAK']);
    const e = buildPdfModel(buildReport(base));
    expect(e.summary.every((l) => l.parts.length === 0)).toBe(true);
  });

  it('calculates student counts and female student counts in the summary table', () => {
    const customSeries: ReportSeries[] = [
      { id: 1, label: 'CSE-23', departmentId: 1, intakeYear: 2023, studentCount: 180, brothersCount: 25 },
      { id: 2, label: 'CE-23', departmentId: 2, intakeYear: 2023, studentCount: 180, brothersCount: 15 },
      { id: 3, label: 'ARCH-23', departmentId: 3, intakeYear: 2023, studentCount: 30, brothersCount: 5 },
      { id: 4, label: 'IPE-23', departmentId: 4, intakeYear: 2023, studentCount: 60, brothersCount: 8 },
    ];
    const report = buildReport({
      ...base,
      series: customSeries,
      femaleStudentPercentage: 15,
      breaks: [
        // CSE-23 (180) + ARCH-23 (30) = 210 students; 15% female = 32
        brk('MID_BREAK', '2026-11-14', '2026-11-20', 1, 4),
        brk('MID_BREAK', '2026-11-14', '2026-11-20', 3, 4),
        // IPE-23 (60) = 60 students; 15% female = 9
        brk('SEMESTER_BREAK', '2026-11-14', '2026-11-20', 4, 3),
      ],
    });
    const model = buildPdfModel(report);
    const w1 = model.summary[0]!;
    expect(w1.parts.length).toBe(2);
    const midBreak = w1.parts.find((p) => p.category === 'MID_BREAK')!;
    expect(midBreak.studentCount).toBe(210);
    expect(midBreak.boysCount).toBe(178); // 210 - 32 = 178
    expect(midBreak.femaleCount).toBe(32); // Math.round(210 * 0.15) = 32
    expect(midBreak.brothersCount).toBe(30); // 25 + 5 = 30

    const semBreak = w1.parts.find((p) => p.category === 'SEMESTER_BREAK')!;
    expect(semBreak.studentCount).toBe(60);
    expect(semBreak.boysCount).toBe(51); // 60 - 9 = 51
    expect(semBreak.femaleCount).toBe(9); // Math.round(60 * 0.15) = 9
    expect(semBreak.brothersCount).toBe(8);

    expect(w1.totalStudentCount).toBe(270);
    expect(w1.totalBoysCount).toBe(229); // 270 - 41 = 229
    expect(w1.totalBrothersCount).toBe(38); // 25 + 5 + 8 = 38
  });

  it('uses selected from date instead of today as reportDate and starting week', () => {
    const custom = buildReport({
      ...base,
      from: '2026-11-19',
      month: '2026-11',
      downloadedAt: '2026-11-19',
    });
    const model = buildPdfModel(custom);
    expect(model.reportDate).toBe('2026-11-19');
    expect(model.summary[0]!.week).toContain('Thu 19–20 Nov');
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

  it('an empty report has no entries', () => {
    const e = buildPdfModel(buildReport(base));
    expect(e.weeks.every((w) => w.entries.length === 0)).toBe(true);
  });
});

describe('whoText', () => {
  it('groups by batch (oldest first), departments A-Z, a lone series by name', () => {
    // series: CSE-23, EEE-23, CSE-24, EEE-24, ME-24
    expect(whoText([5, 6, 4, 1], series)).toBe('CSE-23, Batch 2024 (CSE, EEE, ME)');
    expect(whoText([2, 1], series)).toBe('Batch 2023 (CSE, EEE)');
  });
  it('says Everyone when every active series is off', () => {
    expect(whoText([1, 2, 4, 5, 6], series)).toBe('Everyone');
  });
});
