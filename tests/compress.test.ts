import { describe, expect, test } from 'vitest';
import { appliesToSeries, compressAudience } from '@/core/calendar/compress';
import type { AudienceEntry, Structure } from '@/core/calendar/types';

// Faculties are listed out of order on purpose: sort_order must decide, not array order.
const faculties = [
  { id: 3, code: 'ME', sortOrder: 3 },
  { id: 1, code: 'ECE', sortOrder: 1 },
  { id: 2, code: 'CE', sortOrder: 2 },
];
const depts = {
  EEE: { id: 1, facultyId: 1, code: 'EEE' },
  CSE: { id: 2, facultyId: 1, code: 'CSE' },
  CE: { id: 3, facultyId: 2, code: 'CE' },
  ARCH: { id: 4, facultyId: 2, code: 'ARCH' },
  ME: { id: 5, facultyId: 3, code: 'ME' },
  OLD: { id: 6, facultyId: 1, code: 'OLD' }, // only inactive series: must never block "full"
};
const departments = Object.values(depts);

/** Series id convention: deptId * 100 + two-digit year. */
const sid = (dept: keyof typeof depts, yy: number) => depts[dept].id * 100 + yy;
const series = [
  ...(['EEE', 'CSE', 'CE', 'ARCH', 'ME'] as const).flatMap((d) =>
    [21, 22, 23].map((yy) => ({
      id: sid(d, yy),
      departmentId: depts[d].id,
      intakeYear: 2000 + yy,
      isActive: true,
    })),
  ),
  { id: sid('CSE', 19), departmentId: depts.CSE.id, intakeYear: 2019, isActive: false },
  { id: sid('OLD', 15), departmentId: depts.OLD.id, intakeYear: 2015, isActive: false },
];
const structure: Structure = { faculties, departments, series };

const ALL: AudienceEntry = { scopeType: 'ALL', scopeId: null };
const fac = (id: number): AudienceEntry => ({ scopeType: 'FACULTY', scopeId: id });
const dep = (d: keyof typeof depts): AudienceEntry => ({
  scopeType: 'DEPARTMENT',
  scopeId: depts[d].id,
});
const ser = (d: keyof typeof depts, yy: number): AudienceEntry => ({
  scopeType: 'SERIES',
  scopeId: sid(d, yy),
});

const cases: [string, AudienceEntry[], string][] = [
  ['ALL entry', [ALL], 'ALL'],
  ['empty audience', [], ''],
  ['one full department', [dep('CSE')], 'CSE'],
  ['full department ignores its inactive series', [dep('CSE'), ser('CSE', 19)], 'CSE'],
  ['full faculty', [fac(1)], 'ECE Faculty'],
  ['faculty built from all its departments', [dep('EEE'), dep('CSE')], 'ECE Faculty'],
  ['faculty ignores departments with no active series', [fac(1)], 'ECE Faculty'],
  ['every department collapses to ALL', Object.keys(depts).map((d) => dep(d as 'CSE')), 'ALL'],
  ['every faculty collapses to ALL', [fac(1), fac(2), fac(3)], 'ALL'],
  [
    'every series listed one by one collapses to ALL',
    series.filter((s) => s.isActive).map((s) => ({ scopeType: 'SERIES', scopeId: s.id })),
    'ALL',
  ],
  [
    'mixed series from different departments',
    [ser('ME', 22), ser('EEE', 21), ser('CSE', 23)],
    'CSE-23 · EEE-21 · ME-22',
  ],
  ['department plus loose series', [ser('EEE', 22), dep('CSE')], 'CSE · EEE-22'],
  ['redundant series inside a full department', [dep('CSE'), ser('CSE', 22)], 'CSE'],
  [
    'series of one department: year descending',
    [ser('CSE', 21), ser('CSE', 23)],
    'CSE-23 · CSE-21',
  ],
  ['only an inactive series gives an empty label', [ser('CSE', 19)], ''],
  ['inactive series is dropped from a mix', [ser('CSE', 23), ser('CSE', 19)], 'CSE-23'],
  [
    'faculty then department order, not input order (ME is a one-department faculty)',
    [dep('ME'), dep('ARCH'), dep('CSE')],
    'CSE · ARCH · ME Faculty',
  ],
  [
    'full faculty beside loose series',
    [dep('EEE'), dep('CSE'), ser('ARCH', 23)],
    'ECE Faculty · ARCH-23',
  ],
  ['department code order inside a faculty', [dep('EEE'), ser('CSE', 23)], 'CSE-23 · EEE'],
  ['duplicate entries are harmless', [dep('CSE'), dep('CSE')], 'CSE'],
];

describe('compressAudience', () => {
  test.each(cases)('%s', (_name, audience, expected) => {
    expect(compressAudience(audience, structure)).toBe(expected);
  });
});

describe('appliesToSeries', () => {
  test.each([
    ['ALL covers any active series', [ALL], sid('ME', 21), true],
    ['faculty covers its series', [fac(1)], sid('CSE', 22), true],
    ['faculty does not cover other faculties', [fac(1)], sid('ME', 22), false],
    ['department covers its series only', [dep('CSE')], sid('EEE', 22), false],
    ['series entry matches exactly', [ser('CSE', 23)], sid('CSE', 23), true],
    ['inactive series never applies', [ALL], sid('CSE', 19), false],
    ['unknown series id', [ALL], 99999, false],
  ] as [string, AudienceEntry[], number, boolean][])('%s', (_name, audience, id, expected) => {
    expect(appliesToSeries(audience, structure, id)).toBe(expected);
  });
});
