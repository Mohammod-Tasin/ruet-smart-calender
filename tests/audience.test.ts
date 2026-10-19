import { describe, expect, test } from 'vitest';
import { appliesToDepartment, audienceFromSeries } from '@/core/calendar/audience';
import { coveredSeriesIds } from '@/core/calendar/compress';
import type { Structure } from '@/core/calendar/types';

// Faculty 1: EEE(1) CSE(2); faculty 2: CE(3). Series id = dept*10 + 1..2.
const structure: Structure = {
  faculties: [
    { id: 1, code: 'ECE', sortOrder: 1 },
    { id: 2, code: 'CE', sortOrder: 2 },
  ],
  departments: [
    { id: 1, facultyId: 1, code: 'EEE' },
    { id: 2, facultyId: 1, code: 'CSE' },
    { id: 3, facultyId: 2, code: 'CE' },
  ],
  series: [11, 12, 21, 22, 31, 32].map((id) => ({
    id,
    departmentId: Math.floor(id / 10),
    intakeYear: 2020 + (id % 10),
    isActive: true,
  })),
};

describe('audienceFromSeries', () => {
  test.each([
    ['nothing', [], []],
    ['everything -> ALL', [11, 12, 21, 22, 31, 32], [{ scopeType: 'ALL', scopeId: null }]],
    ['whole faculty', [11, 12, 21, 22], [{ scopeType: 'FACULTY', scopeId: 1 }]],
    [
      'whole department + loose series',
      [31, 32, 11],
      [
        { scopeType: 'SERIES', scopeId: 11 },
        { scopeType: 'FACULTY', scopeId: 2 }, // CE is the only department of faculty 2
      ],
    ],
    [
      'department + single-department faculty',
      [21, 22, 31, 32],
      [
        { scopeType: 'DEPARTMENT', scopeId: 2 },
        { scopeType: 'FACULTY', scopeId: 2 },
      ],
    ],
    ['one series', [22], [{ scopeType: 'SERIES', scopeId: 22 }]],
  ])('%s', (_name, ids, want) => {
    expect(audienceFromSeries(new Set(ids), structure)).toEqual(want);
  });

  test('round-trips through coveredSeriesIds', () => {
    for (const ids of [[11], [11, 12, 21], [12, 22, 32], [11, 12, 21, 22, 31]]) {
      const back = coveredSeriesIds(audienceFromSeries(new Set(ids), structure), structure);
      expect([...back].sort()).toEqual([...ids].sort());
    }
  });
});

test('appliesToDepartment', () => {
  const faculty = [{ scopeType: 'FACULTY' as const, scopeId: 1 }];
  expect(appliesToDepartment(faculty, structure, 2)).toBe(true);
  expect(appliesToDepartment(faculty, structure, 3)).toBe(false);
  expect(appliesToDepartment([{ scopeType: 'SERIES', scopeId: 31 }], structure, 3)).toBe(true);
});
