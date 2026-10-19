import { describe, expect, test } from 'vitest';
import { findOverlaps, type OverlapInput } from '@/core/calendar/overlap';
import type { AudienceEntry, Structure } from '@/core/calendar/types';

// ECE: EEE(1), CSE(2) | CE: CE(3), ARCH(4) | ME: ME(5)
// OLD(6) in ECE has only an inactive series. Series id = deptId * 100 + two-digit year.
const structure: Structure = {
  faculties: [
    { id: 1, code: 'ECE', sortOrder: 1 },
    { id: 2, code: 'CE', sortOrder: 2 },
    { id: 3, code: 'ME', sortOrder: 3 },
  ],
  departments: [
    { id: 1, facultyId: 1, code: 'EEE' },
    { id: 2, facultyId: 1, code: 'CSE' },
    { id: 3, facultyId: 2, code: 'CE' },
    { id: 4, facultyId: 2, code: 'ARCH' },
    { id: 5, facultyId: 3, code: 'ME' },
    { id: 6, facultyId: 1, code: 'OLD' },
  ],
  series: [
    ...[1, 2, 3, 4, 5].flatMap((d) =>
      [22, 23].map((yy) => ({
        id: d * 100 + yy,
        departmentId: d,
        intakeYear: 2000 + yy,
        isActive: true,
      })),
    ),
    { id: 615, departmentId: 6, intakeYear: 2015, isActive: false },
    { id: 219, departmentId: 2, intakeYear: 2019, isActive: false }, // CSE-19, inactive
  ],
};

const ALL: AudienceEntry = { scopeType: 'ALL', scopeId: null };
const fac = (id: number): AudienceEntry => ({ scopeType: 'FACULTY', scopeId: id });
const dep = (id: number): AudienceEntry => ({ scopeType: 'DEPARTMENT', scopeId: id });
const ser = (deptId: number, yy: number): AudienceEntry => ({
  scopeType: 'SERIES',
  scopeId: deptId * 100 + yy,
});
const EEE = 1;
const CSE = 2;
const CE = 3;
const ARCH = 4;
const ME = 5;
const OLD = 6;

const h = (id: number, startDate: string, endDate: string, audience: AudienceEntry[]) => ({
  id,
  startDate,
  endDate,
  audience,
});
const cand = (startDate: string, endDate: string, audience: AudienceEntry[]): OverlapInput => ({
  startDate,
  endDate,
  audience,
});

type Row = [
  name: string,
  candidate: OverlapInput,
  existing: ReturnType<typeof h>[],
  excludeId: number | undefined,
  expected: { id: number; start: string; end: string; shared: string }[],
];

const rows: Row[] = [
  // --- date edges
  [
    'same single day overlaps',
    cand('2026-10-10', '2026-10-10', [dep(CSE)]),
    [h(1, '2026-10-10', '2026-10-10', [dep(CSE)])],
    undefined,
    [{ id: 1, start: '2026-10-10', end: '2026-10-10', shared: 'CSE' }],
  ],
  [
    'ranges touching at one day overlap (end == start)',
    cand('2026-10-10', '2026-10-12', [dep(CSE)]),
    [h(1, '2026-10-12', '2026-10-15', [dep(CSE)])],
    undefined,
    [{ id: 1, start: '2026-10-12', end: '2026-10-12', shared: 'CSE' }],
  ],
  [
    'adjacent days do not overlap (end + 1 == start)',
    cand('2026-10-10', '2026-10-11', [dep(CSE)]),
    [h(1, '2026-10-12', '2026-10-15', [dep(CSE)])],
    undefined,
    [],
  ],
  [
    'existing ends the day before the candidate starts',
    cand('2026-10-10', '2026-10-12', [dep(CSE)]),
    [h(1, '2026-10-01', '2026-10-09', [dep(CSE)])],
    undefined,
    [],
  ],
  [
    'candidate fully inside existing: overlap is the candidate range',
    cand('2026-10-11', '2026-10-12', [dep(CSE)]),
    [h(1, '2026-10-01', '2026-10-31', [dep(CSE)])],
    undefined,
    [{ id: 1, start: '2026-10-11', end: '2026-10-12', shared: 'CSE' }],
  ],
  [
    'existing fully inside candidate: overlap is the existing range',
    cand('2026-10-01', '2026-10-31', [dep(CSE)]),
    [h(1, '2026-10-11', '2026-10-12', [dep(CSE)])],
    undefined,
    [{ id: 1, start: '2026-10-11', end: '2026-10-12', shared: 'CSE' }],
  ],
  [
    'partial overlap across a month boundary',
    cand('2026-10-30', '2026-11-02', [dep(CSE)]),
    [h(1, '2026-11-01', '2026-11-05', [dep(CSE)])],
    undefined,
    [{ id: 1, start: '2026-11-01', end: '2026-11-02', shared: 'CSE' }],
  ],
  [
    'year boundary',
    cand('2026-12-31', '2027-01-01', [dep(CSE)]),
    [h(1, '2027-01-01', '2027-01-03', [dep(CSE)])],
    undefined,
    [{ id: 1, start: '2027-01-01', end: '2027-01-01', shared: 'CSE' }],
  ],

  // --- audiences
  [
    'ALL vs ALL',
    cand('2026-10-10', '2026-10-10', [ALL]),
    [h(1, '2026-10-10', '2026-10-10', [ALL])],
    undefined,
    [{ id: 1, start: '2026-10-10', end: '2026-10-10', shared: 'ALL' }],
  ],
  [
    'ALL vs one series: shared is just that series',
    cand('2026-10-10', '2026-10-10', [ALL]),
    [h(1, '2026-10-10', '2026-10-10', [ser(EEE, 23)])],
    undefined,
    [{ id: 1, start: '2026-10-10', end: '2026-10-10', shared: 'EEE-23' }],
  ],
  [
    'one series vs ALL (reverse direction)',
    cand('2026-10-10', '2026-10-10', [ser(EEE, 23)]),
    [h(1, '2026-10-10', '2026-10-10', [ALL])],
    undefined,
    [{ id: 1, start: '2026-10-10', end: '2026-10-10', shared: 'EEE-23' }],
  ],
  [
    'department vs one of its series',
    cand('2026-10-10', '2026-10-10', [ser(EEE, 23)]),
    [h(1, '2026-10-10', '2026-10-10', [dep(EEE)])],
    undefined,
    [{ id: 1, start: '2026-10-10', end: '2026-10-10', shared: 'EEE-23' }],
  ],
  [
    'department vs a series of another department',
    cand('2026-10-10', '2026-10-10', [dep(EEE)]),
    [h(1, '2026-10-10', '2026-10-10', [ser(CSE, 23)])],
    undefined,
    [],
  ],
  [
    'faculty vs a department inside it: shared is that department',
    cand('2026-10-10', '2026-10-10', [fac(1)]),
    [h(1, '2026-10-10', '2026-10-10', [dep(EEE)])],
    undefined,
    [{ id: 1, start: '2026-10-10', end: '2026-10-10', shared: 'EEE' }],
  ],
  [
    'faculty vs a department of another faculty',
    cand('2026-10-10', '2026-10-10', [fac(1)]),
    [h(1, '2026-10-10', '2026-10-10', [dep(CE)])],
    undefined,
    [],
  ],
  [
    'two faculties: shared is the whole first faculty when it is fully covered',
    cand('2026-10-10', '2026-10-10', [fac(1), fac(2)]),
    [h(1, '2026-10-10', '2026-10-10', [fac(1)])],
    undefined,
    [{ id: 1, start: '2026-10-10', end: '2026-10-10', shared: 'ECE Faculty' }],
  ],
  [
    'different departments, same dates: no shared series',
    cand('2026-10-10', '2026-10-12', [dep(EEE)]),
    [h(1, '2026-10-10', '2026-10-12', [dep(CSE)])],
    undefined,
    [],
  ],
  [
    'different series of the same department: no shared series',
    cand('2026-10-10', '2026-10-12', [ser(EEE, 22)]),
    [h(1, '2026-10-10', '2026-10-12', [ser(EEE, 23)])],
    undefined,
    [],
  ],
  [
    'shared part is a mix, ordered and compressed',
    cand('2026-10-10', '2026-10-10', [dep(EEE), ser(ME, 22)]),
    [h(1, '2026-10-10', '2026-10-10', [ser(EEE, 23), ser(ME, 22), ser(CE, 22)])],
    undefined,
    [{ id: 1, start: '2026-10-10', end: '2026-10-10', shared: 'EEE-23 · ME-22' }],
  ],

  // --- inactive series
  [
    'inactive series is ignored: only shared series is inactive',
    cand('2026-10-10', '2026-10-10', [{ scopeType: 'SERIES', scopeId: 219 }]),
    [h(1, '2026-10-10', '2026-10-10', [{ scopeType: 'SERIES', scopeId: 219 }])],
    undefined,
    [],
  ],
  [
    'department with only inactive series never overlaps',
    cand('2026-10-10', '2026-10-10', [dep(OLD)]),
    [h(1, '2026-10-10', '2026-10-10', [ALL])],
    undefined,
    [],
  ],
  [
    'inactive series do not widen the shared label',
    cand('2026-10-10', '2026-10-10', [dep(CSE)]),
    [h(1, '2026-10-10', '2026-10-10', [dep(CSE)])],
    undefined,
    [{ id: 1, start: '2026-10-10', end: '2026-10-10', shared: 'CSE' }],
  ],

  // --- editing
  [
    'update excludes itself',
    cand('2026-10-10', '2026-10-12', [dep(CSE)]),
    [h(7, '2026-10-10', '2026-10-12', [dep(CSE)])],
    7,
    [],
  ],
  [
    'update still clashes with others',
    cand('2026-10-10', '2026-10-12', [dep(CSE)]),
    [h(7, '2026-10-10', '2026-10-12', [dep(CSE)]), h(8, '2026-10-11', '2026-10-11', [ALL])],
    7,
    [{ id: 8, start: '2026-10-11', end: '2026-10-11', shared: 'CSE' }],
  ],

  // --- misc
  ['no existing holidays', cand('2026-10-10', '2026-10-10', [ALL]), [], undefined, []],
  [
    'empty candidate audience clashes with nothing',
    cand('2026-10-10', '2026-10-10', []),
    [h(1, '2026-10-10', '2026-10-10', [ALL])],
    undefined,
    [],
  ],
  [
    'empty existing audience clashes with nothing',
    cand('2026-10-10', '2026-10-10', [ALL]),
    [h(1, '2026-10-10', '2026-10-10', [])],
    undefined,
    [],
  ],
  [
    'results are ordered by start date then id',
    cand('2026-10-01', '2026-10-31', [dep(CSE)]),
    [
      h(3, '2026-10-20', '2026-10-21', [dep(CSE)]),
      h(2, '2026-10-05', '2026-10-06', [dep(CSE)]),
      h(1, '2026-10-05', '2026-10-05', [dep(CSE)]),
    ],
    undefined,
    [
      { id: 1, start: '2026-10-05', end: '2026-10-05', shared: 'CSE' },
      { id: 2, start: '2026-10-05', end: '2026-10-06', shared: 'CSE' },
      { id: 3, start: '2026-10-20', end: '2026-10-21', shared: 'CSE' },
    ],
  ],
  [
    'untouched departments are not reported',
    cand('2026-10-10', '2026-10-10', [dep(ARCH)]),
    [h(1, '2026-10-10', '2026-10-10', [dep(CE)]), h(2, '2026-10-10', '2026-10-10', [dep(ARCH)])],
    undefined,
    [{ id: 2, start: '2026-10-10', end: '2026-10-10', shared: 'ARCH' }],
  ],
];

describe('findOverlaps', () => {
  test.each(rows)('%s', (_name, candidate, existing, excludeId, expected) => {
    const result = findOverlaps(candidate, existing, structure, excludeId).map((o) => ({
      id: o.holiday.id,
      start: o.overlapStart,
      end: o.overlapEnd,
      shared: o.sharedLabel,
    }));
    expect(result).toEqual(expected);
  });
});
