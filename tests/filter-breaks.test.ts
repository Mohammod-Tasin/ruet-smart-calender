import { describe, expect, it } from 'vitest';
import type { Structure } from '@/core/calendar/types';
import type { PublicHoliday } from '@/lib/api';
import {
  appliesToDept,
  breakDisplaySpan,
  filterAndMergeBreaks,
  filterHolidays,
  formatExamTitle,
  isCommonHoliday,
  mergeSameBreaks,
  scopeSeriesIds,
  type CalendarFilter,
} from '@/lib/filter-breaks';
import type { AcademicBreakItem } from '@/server/services/journey';

const structure: Structure = {
  faculties: [{ id: 1, code: 'ECE', name: 'Faculty of ECE', sortOrder: 1 }],
  departments: [
    { id: 10, facultyId: 1, code: 'CSE' },
    { id: 20, facultyId: 1, code: 'EEE' },
  ],
  series: [
    { id: 101, departmentId: 10, intakeYear: 2021, isActive: true },
    { id: 102, departmentId: 10, intakeYear: 2022, isActive: true },
    { id: 103, departmentId: 10, intakeYear: 2023, isActive: true },
    { id: 201, departmentId: 20, intakeYear: 2021, isActive: true },
    { id: 202, departmentId: 20, intakeYear: 2022, isActive: true },
  ],
};

const commonHoliday: PublicHoliday = {
  id: 1,
  title: 'Eid-ul-Fitr',
  note: null,
  category: 'HOLIDAY',
  classesOnly: false,
  startDate: '2026-03-20',
  endDate: '2026-03-25',
  audience: [{ scopeType: 'ALL', scopeId: 0 }],
  label: 'ALL',
  source: 'ONE_OFF',
  tentative: false,
  updatedBy: { name: 'Admin' },
  updatedAt: '2026-01-01',
};

const cseHoliday: PublicHoliday = {
  id: 2,
  title: 'CSE Fest',
  note: null,
  category: 'HOLIDAY',
  classesOnly: true,
  startDate: '2026-04-10',
  endDate: '2026-04-11',
  audience: [{ scopeType: 'DEPARTMENT', scopeId: 10 }],
  label: 'CSE',
  source: 'ONE_OFF',
  tentative: false,
  updatedBy: { name: 'Admin' },
  updatedAt: '2026-01-01',
};

const cse21Holiday: PublicHoliday = {
  id: 3,
  title: 'CSE-21 Tour',
  note: null,
  category: 'HOLIDAY',
  classesOnly: true,
  startDate: '2026-05-01',
  endDate: '2026-05-03',
  audience: [{ scopeType: 'SERIES', scopeId: 101 }],
  label: 'CSE-21',
  source: 'ONE_OFF',
  tentative: false,
  updatedBy: { name: 'Admin' },
  updatedAt: '2026-01-01',
};

describe('filterHolidays', () => {
  it('COMMON scope returns only common holidays', () => {
    const list = [commonHoliday, cseHoliday, cse21Holiday];
    const res = filterHolidays(list, structure, { scope: 'COMMON', showEverything: false });
    expect(res).toEqual([commonHoliday]);
  });

  it('ALL_DEPTS scope returns all holidays', () => {
    const list = [commonHoliday, cseHoliday, cse21Holiday];
    const res = filterHolidays(list, structure, { scope: 'ALL_DEPTS', showEverything: false });
    expect(res).toHaveLength(3);
  });

  it('ALL_DEPTS with batch returns common + holidays applying to that batch', () => {
    const list = [commonHoliday, cseHoliday, cse21Holiday];
    // Batch 2021 matches commonHoliday, cseHoliday (covers all CSE active series including 2021), and cse21Holiday
    const res21 = filterHolidays(list, structure, {
      scope: 'ALL_DEPTS',
      batch: 2021,
      showEverything: false,
    });
    expect(res21).toHaveLength(3);

    // Batch 2022 matches commonHoliday and cseHoliday, but NOT cse21Holiday
    const res22 = filterHolidays(list, structure, {
      scope: 'ALL_DEPTS',
      batch: 2022,
      showEverything: false,
    });
    expect(res22).toEqual([commonHoliday, cseHoliday]);
  });

  it('DEPT scope returns common + specific department holidays', () => {
    const list = [commonHoliday, cseHoliday, cse21Holiday];
    const res = filterHolidays(list, structure, {
      scope: 'DEPT',
      deptId: 10,
      showEverything: false,
    });
    expect(res).toEqual([commonHoliday, cseHoliday, cse21Holiday]);

    // For EEE (dept 20), only common holiday should match
    const resEEE = filterHolidays(list, structure, {
      scope: 'DEPT',
      deptId: 20,
      showEverything: false,
    });
    expect(resEEE).toEqual([commonHoliday]);
  });

  it('SERIES scope returns common + specific series holidays', () => {
    const list = [commonHoliday, cseHoliday, cse21Holiday];
    const res21 = filterHolidays(list, structure, {
      scope: 'SERIES',
      seriesId: 101,
      showEverything: false,
    });
    expect(res21).toEqual([commonHoliday, cseHoliday, cse21Holiday]);

    const res22 = filterHolidays(list, structure, {
      scope: 'SERIES',
      seriesId: 102,
      showEverything: false,
    });
    expect(res22).toEqual([commonHoliday, cseHoliday]);
  });
});

describe('filterAndMergeBreaks', () => {
  const breaks: AcademicBreakItem[] = [
    {
      id: 'mid:101:8:2026-10-17',
      title: 'Mid-term break',
      category: 'MID_BREAK',
      startDate: '2026-10-17',
      endDate: '2026-10-21',
      seriesId: 101,
      departmentId: 10,
      series: 'CSE-21',
      deptCode: 'CSE',
      intakeYear: 2021,
      semesterNo: 8,
      tentative: false,
    },
    {
      id: 'mid:102:6:2026-10-17',
      title: 'Mid-term break',
      category: 'MID_BREAK',
      startDate: '2026-10-17',
      endDate: '2026-10-21',
      seriesId: 102,
      departmentId: 10,
      series: 'CSE-22',
      deptCode: 'CSE',
      intakeYear: 2022,
      semesterNo: 6,
      tentative: false,
    },
    {
      id: 'mid:201:8:2026-10-17',
      title: 'Mid-term break',
      category: 'MID_BREAK',
      startDate: '2026-10-17',
      endDate: '2026-10-21',
      seriesId: 201,
      departmentId: 20,
      series: 'EEE-21',
      deptCode: 'EEE',
      intakeYear: 2021,
      semesterNo: 8,
      tentative: false,
    },
  ];

  it('returns empty when in COMMON scope without showEverything', () => {
    expect(
      filterAndMergeBreaks(breaks, [], structure, { scope: 'COMMON', showEverything: false }),
    ).toEqual([]);
    // With ALL_DEPTS, breaks show even when showEverything is false:
    expect(
      filterAndMergeBreaks(breaks, [], structure, { scope: 'ALL_DEPTS', showEverything: false }),
    ).toHaveLength(1);
  });

  it('hides CLASS weeks when showEverything is false, but shows them when true', () => {
    const classItem: AcademicBreakItem = {
      id: 'class:101:5:1:2026-10-31',
      title: 'Class week 1',
      category: 'CLASS',
      startDate: '2026-10-31',
      endDate: '2026-11-04',
      seriesId: 101,
      departmentId: 10,
      series: 'CSE-21',
      deptCode: 'CSE',
      intakeYear: 2021,
      semesterNo: 5,
      tentative: false,
    };
    // showEverything false: CLASS week hidden
    const resOff = filterAndMergeBreaks([classItem], [], structure, {
      scope: 'ALL_DEPTS',
      showEverything: false,
    });
    expect(resOff).toEqual([]);

    // showEverything true: CLASS week shown
    const resOn = filterAndMergeBreaks([classItem], [], structure, {
      scope: 'ALL_DEPTS',
      showEverything: true,
    });
    expect(resOn).toHaveLength(1);
    expect(resOn[0]?.category).toBe('CLASS');
  });

  it('merges all series sharing the same event and dates into a single strip', () => {
    const res = filterAndMergeBreaks(breaks, [], structure, {
      scope: 'ALL_DEPTS',
      showEverything: true,
    });
    // CSE-21, CSE-22 and EEE-21 share the same mid break dates → ONE strip
    expect(res).toHaveLength(1);

    const bar = res[0]!;
    expect(bar.label).toBe('CSE-21 · CSE-22 · EEE-21');
    expect(bar.startDate).toBe('2026-10-17');
    expect(bar.endDate).toBe('2026-10-21');
    expect(bar.category).toBe('MID_BREAK');
    expect(bar.note).toBeNull();
    // Different semesters → no "(Sem x)" in the title
    expect(bar.title).toBe('Mid-term break');
  });

  it('labels with full dept code when all active series of department have the break', () => {
    // Add CSE-23 break so all 3 active CSE series have it
    const allCseBreaks: AcademicBreakItem[] = [
      ...breaks,
      {
        id: 'mid:103:4:2026-10-17',
        title: 'Mid-term break',
        category: 'MID_BREAK',
        startDate: '2026-10-17',
        endDate: '2026-10-21',
        seriesId: 103,
        departmentId: 10,
        series: 'CSE-23',
        deptCode: 'CSE',
        intakeYear: 2023,
        semesterNo: 4,
        tentative: false,
      },
    ];

    const res = filterAndMergeBreaks(allCseBreaks, [], structure, {
      scope: 'ALL_DEPTS',
      showEverything: true,
    });
    const cseBar = res.find((r) => r.audience.some((a) => a.scopeId === 101));
    expect(cseBar?.label).toBe('CSE · EEE-21');
  });

  it('keeps single series break when filtering by SERIES scope', () => {
    const res = filterAndMergeBreaks(breaks, [], structure, {
      scope: 'SERIES',
      seriesId: 101,
      showEverything: true,
    });
    expect(res).toHaveLength(1);
    expect(res[0]?.label).toBe('CSE-21');
    expect(res[0]?.title).toBe('Mid-term break (Sem 4-2)');
  });

  it('does not duplicate if an explicit holiday already exists for that series and category', () => {
    const explicitMidBreak: PublicHoliday = {
      id: 99,
      title: 'Mid Break',
      note: null,
      category: 'MID_BREAK',
      classesOnly: true,
      startDate: '2026-10-17',
      endDate: '2026-10-21',
      audience: [{ scopeType: 'SERIES', scopeId: 101 }],
      label: 'CSE-21',
      source: 'ONE_OFF',
      tentative: false,
      updatedBy: { name: 'Admin' },
      updatedAt: '2026-01-01',
    };

    const res = filterAndMergeBreaks(breaks, [explicitMidBreak], structure, {
      scope: 'SERIES',
      seriesId: 101,
      showEverything: true,
    });
    // CSE-21 break is skipped because explicitMidBreak already exists
    expect(res).toHaveLength(0);
  });

  it('renders mid break strip from previous week Thursday to break week Friday', () => {
    // Week starting Saturday 2026-11-14:
    // Thursday before is 2026-11-12, Friday of that week is 2026-11-20
    const midBreakItem: AcademicBreakItem = {
      id: 'mid:101:5:2026-11-12',
      title: 'Mid-term break',
      category: 'MID_BREAK',
      startDate: '2026-11-12', // Thursday
      endDate: '2026-11-20',   // Friday
      seriesId: 101,
      departmentId: 10,
      series: 'CSE-21',
      deptCode: 'CSE',
      intakeYear: 2021,
      semesterNo: 5,
      tentative: false,
    };
    const res = filterAndMergeBreaks([midBreakItem], [], structure, {
      scope: 'SERIES',
      seriesId: 101,
      showEverything: true,
    });
    expect(res).toHaveLength(1);
    expect(res[0]?.startDate).toBe('2026-11-12');
    expect(res[0]?.endDate).toBe('2026-11-20');
  });

  it('renders semester break strip from day after E5 to Friday of that week', () => {
    // E5 is on Saturday 2027-03-20.
    // Day after E5 is Sunday 2027-03-21, and Friday of that week is 2027-03-26.
    const semBreakItem: AcademicBreakItem = {
      id: 'sem:101:5:2027-03-21',
      title: 'Semester break',
      category: 'SEMESTER_BREAK',
      startDate: '2027-03-21', // Sunday (day after E5)
      endDate: '2027-03-26',   // Friday of that week
      seriesId: 101,
      departmentId: 10,
      series: 'CSE-21',
      deptCode: 'CSE',
      intakeYear: 2021,
      semesterNo: 5,
      tentative: false,
    };
    const res = filterAndMergeBreaks([semBreakItem], [], structure, {
      scope: 'SERIES',
      seriesId: 101,
      showEverything: true,
    });
    expect(res).toHaveLength(1);
    expect(res[0]?.startDate).toBe('2027-03-21');
    expect(res[0]?.endDate).toBe('2027-03-26');
  });
});

describe('breakDisplaySpan', () => {
  const b = (category: string, startDate: string, endDate: string) =>
    breakDisplaySpan({ category, startDate, endDate });

  it('mid break stored Sat-Wed spans previous Thu to Fri of break week', () => {
    // Break week Sat 14 Nov 2026 - Wed 18 Nov
    expect(b('MID_BREAK', '2026-11-14', '2026-11-18')).toEqual({
      category: 'MID_BREAK', startDate: '2026-11-12', endDate: '2026-11-20',
    });
  });

  it('is idempotent for an already Thu-Fri span', () => {
    expect(b('UNOFFICIAL_BREAK', '2026-11-12', '2026-11-20')).toMatchObject({
      startDate: '2026-11-12', endDate: '2026-11-20',
    });
  });

  it('multi-week unofficial break ends on Friday of last week', () => {
    expect(b('UNOFFICIAL_BREAK', '2026-11-14', '2026-11-25')).toMatchObject({
      startDate: '2026-11-12', endDate: '2026-11-27',
    });
  });

  it('semester break runs from day after E5 to Friday of that week', () => {
    expect(b('SEMESTER_BREAK', '2027-03-21', '2027-03-21')).toMatchObject({
      startDate: '2027-03-21', endDate: '2027-03-26',
    });
  });

  it('leaves other holidays unchanged', () => {
    expect(b('HOLIDAY', '2026-12-16', '2026-12-16')).toMatchObject({
      startDate: '2026-12-16', endDate: '2026-12-16',
    });
  });
});
describe('mergeSameBreaks', () => {
  const unofficial = (id: number, seriesId: number, label: string): PublicHoliday => ({
    id,
    title: 'Unofficial Break',
    note: null,
    category: 'UNOFFICIAL_BREAK',
    classesOnly: true,
    startDate: '2026-10-29',
    endDate: '2026-11-06',
    audience: [{ scopeType: 'SERIES', scopeId: seriesId }],
    label,
    source: 'ONE_OFF',
    tentative: false,
    updatedBy: { name: 'Admin' },
    updatedAt: '2026-01-01',
  });

  it('puts same-event same-date breaks saved per series into one strip', () => {
    const res = mergeSameBreaks(
      [unofficial(1, 202, 'EEE-22'), unofficial(2, 101, 'CSE-21'), commonHoliday],
      structure,
    );
    expect(res).toHaveLength(2);
    const strip = res.find((h) => h.category === 'UNOFFICIAL_BREAK')!;
    expect(strip.label).toBe('CSE-21 · EEE-22');
    expect(strip.title).toBe('Unofficial Break');
  });

  it('keeps breaks on different dates apart', () => {
    const other = { ...unofficial(3, 102, 'CSE-22'), startDate: '2026-11-05', endDate: '2026-11-13' };
    expect(mergeSameBreaks([unofficial(1, 202, 'EEE-22'), other], structure)).toHaveLength(2);
  });

  it('only names the selected department series when a department is selected', () => {
    const multi: PublicHoliday = {
      ...unofficial(4, 102, 'CSE-22 · EEE-22'),
      audience: [
        { scopeType: 'SERIES', scopeId: 102 },
        { scopeType: 'SERIES', scopeId: 202 },
      ],
    };
    const scope = scopeSeriesIds({ scope: 'DEPT', deptId: 20, showEverything: false }, structure);
    const res = mergeSameBreaks([multi], structure, scope);
    expect(res).toHaveLength(1);
    expect(res[0]!.label).toBe('EEE-22');
  });
});

describe('formatExamTitle and exam merging', () => {
  const examItem = (
    seriesId: number,
    departmentId: number,
    deptCode: string,
    intakeYear: number,
    weekNo: number,
    date = '2026-10-14',
  ): AcademicBreakItem => ({
    id: `exam:${seriesId}:3:${weekNo}:${date}`,
    title: `Semester Final (E${weekNo})`,
    category: 'EXAM',
    startDate: date,
    endDate: date,
    seriesId,
    departmentId,
    series: `${deptCode}-${String(intakeYear % 100).padStart(2, '0')}`,
    deptCode,
    intakeYear,
    semesterNo: 3,
    weekNo,
    tentative: false,
  });

  it('formats exam title with multiple series and exam weeks as Final E1-CE-23 · EEE-23 · E2-CE-24', () => {
    // Structure has CSE (10) series: 101 (2021), 102 (2022), 103 (2023)
    // and EEE (20) series: 201 (2021), 202 (2022)
    const items: AcademicBreakItem[] = [
      examItem(103, 10, 'CSE', 2023, 1), // E1 for CSE-23
      examItem(202, 20, 'EEE', 2022, 1), // E1 for EEE-22
      examItem(102, 10, 'CSE', 2022, 2), // E2 for CSE-22
    ];
    const title = formatExamTitle(items, structure);
    expect(title).toBe('Final E1-CSE-23 · EEE-22 · E2-CSE-22');
  });

  it('filters by department scope when department is selected', () => {
    const items: AcademicBreakItem[] = [
      examItem(103, 10, 'CSE', 2023, 1),
      examItem(202, 20, 'EEE', 2022, 1),
    ];
    const scope = scopeSeriesIds({ scope: 'DEPT', deptId: 10, showEverything: false }, structure);
    const title = formatExamTitle(items, structure, scope);
    expect(title).toBe('Final E1-CSE-23');
  });

  it('filterAndMergeBreaks outputs single exam strip with formatted title', () => {
    const items: AcademicBreakItem[] = [
      examItem(103, 10, 'CSE', 2023, 1),
      examItem(202, 20, 'EEE', 2022, 1),
    ];
    const filter: CalendarFilter = { scope: 'ALL_DEPTS', showEverything: false };
    const res = filterAndMergeBreaks(items, [], structure, filter);
    expect(res).toHaveLength(1);
    expect(res[0]!.title).toBe('Final E1-CSE-23 · EEE-22');
    expect(res[0]!.label).toBe('ALL');
  });

  it('filterAndMergeBreaks in single series scope outputs Final E1-CSE-23', () => {
    const items: AcademicBreakItem[] = [examItem(103, 10, 'CSE', 2023, 1)];
    const filter: CalendarFilter = {
      scope: 'SERIES',
      seriesId: 103,
      deptId: 10,
      deptCode: 'CSE',
      batch: 2023,
      showEverything: false,
    };
    const res = filterAndMergeBreaks(items, [], structure, filter);
    expect(res).toHaveLength(1);
    expect(res[0]!.title).toBe('Final E1-CSE-23');
    expect(res[0]!.label).toBe('ALL');
  });

  it('assigns unique ids to distinct class weeks in the same date range', () => {
    const class1: AcademicBreakItem = {
      id: 'class:101:1:1:2026-10-31',
      title: 'Class week 1',
      category: 'CLASS',
      startDate: '2026-10-31',
      endDate: '2026-11-04',
      seriesId: 101,
      departmentId: 10,
      series: 'CSE-21',
      deptCode: 'CSE',
      intakeYear: 2021,
      semesterNo: 1,
      weekNo: 1,
      tentative: false,
    };
    const class5: AcademicBreakItem = {
      id: 'class:102:3:5:2026-10-31',
      title: 'Class week 5',
      category: 'CLASS',
      startDate: '2026-10-31',
      endDate: '2026-11-04',
      seriesId: 102,
      departmentId: 10,
      series: 'CSE-22',
      deptCode: 'CSE',
      intakeYear: 2022,
      semesterNo: 3,
      weekNo: 5,
      tentative: false,
    };
    const res = filterAndMergeBreaks([class1, class5], [], structure, {
      scope: 'ALL_DEPTS',
      showEverything: true,
    });
    expect(res).toHaveLength(2);
    expect(res[0]!.id).not.toBe(res[1]!.id);
    expect(res.map((r) => r.id)).toEqual([
      'break-merged:CLASS:Class week 1:2026-10-31:2026-11-04',
      'break-merged:CLASS:Class week 5:2026-10-31:2026-11-04',
    ]);
  });

  it('removes CLASS items when showEverything is false while keeping exams', () => {
    const classItem: AcademicBreakItem = {
      id: 'class:101:1:1:2026-10-31',
      title: 'Class week 1',
      category: 'CLASS',
      startDate: '2026-10-31',
      endDate: '2026-11-04',
      seriesId: 101,
      departmentId: 10,
      series: 'CSE-21',
      deptCode: 'CSE',
      intakeYear: 2021,
      semesterNo: 1,
      weekNo: 1,
      tentative: false,
    };
    const exam = examItem(101, 10, 'CSE', 2021, 1, '2026-10-31');
    const withEverything = filterAndMergeBreaks([classItem, exam], [], structure, {
      scope: 'ALL_DEPTS',
      showEverything: true,
    });
    expect(withEverything).toHaveLength(2);

    const withoutEverything = filterAndMergeBreaks([classItem, exam], [], structure, {
      scope: 'ALL_DEPTS',
      showEverything: false,
    });
    expect(withoutEverything).toHaveLength(1);
    expect(withoutEverything[0]!.category).toBe('EXAM');
  });
});