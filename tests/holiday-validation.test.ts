import { describe, expect, test } from 'vitest';
import {
  checkOverlapSchema,
  createHolidaySchema,
  patchHolidaySchema,
} from '@/core/validation/holiday';

const ok = {
  title: 'Eid',
  startDate: '2026-10-10',
  endDate: '2026-10-12',
  audience: [{ scopeType: 'ALL' }],
};

describe('createHolidaySchema', () => {
  test('accepts a minimal body and normalises it', () => {
    const r = createHolidaySchema.safeParse({ ...ok, title: '  Eid  ' });
    expect(r.success && r.data.title).toBe('Eid');
    expect(r.success && r.data.audience).toEqual([{ scopeType: 'ALL', scopeId: null }]);
  });

  test('empty note becomes null, a real note is trimmed', () => {
    const a = createHolidaySchema.safeParse({ ...ok, note: '   ' });
    expect(a.success && a.data.note).toBeNull();
    const b = createHolidaySchema.safeParse({ ...ok, note: ' Govt notice ' });
    expect(b.success && b.data.note).toBe('Govt notice');
  });

  test.each<[string, Record<string, unknown>]>([
    ['empty title', { title: '   ' }],
    ['title over 100', { title: 'x'.repeat(101) }],
    ['note over 500', { note: 'x'.repeat(501) }],
    ['impossible start date', { startDate: '2026-02-30' }],
    ['bad end date format', { endDate: '10/12/2026' }],
    ['end before start', { startDate: '2026-10-12', endDate: '2026-10-11' }],
    ['empty audience', { audience: [] }],
    ['audience missing', { audience: undefined }],
    ['ALL with an id', { audience: [{ scopeType: 'ALL', scopeId: 3 }] }],
    ['DEPARTMENT without id', { audience: [{ scopeType: 'DEPARTMENT' }] }],
    ['DEPARTMENT with null id', { audience: [{ scopeType: 'DEPARTMENT', scopeId: null }] }],
    ['negative id', { audience: [{ scopeType: 'SERIES', scopeId: -1 }] }],
    ['fractional id', { audience: [{ scopeType: 'SERIES', scopeId: 1.5 }] }],
    ['unknown scope type', { audience: [{ scopeType: 'SECTION', scopeId: 1 }] }],
    [
      'duplicate entries',
      {
        audience: [
          { scopeType: 'SERIES', scopeId: 4 },
          { scopeType: 'SERIES', scopeId: 4 },
        ],
      },
    ],
    [
      'duplicate ALL',
      {
        audience: [{ scopeType: 'ALL' }, { scopeType: 'ALL' }],
      },
    ],
    ['confirmOverlap not boolean', { confirmOverlap: 'yes' }],
  ])('rejects %s', (_n, override) => {
    expect(createHolidaySchema.safeParse({ ...ok, ...override }).success).toBe(false);
  });

  test('same id in different scopes is not a duplicate', () => {
    const r = createHolidaySchema.safeParse({
      ...ok,
      audience: [
        { scopeType: 'FACULTY', scopeId: 1 },
        { scopeType: 'DEPARTMENT', scopeId: 1 },
      ],
    });
    expect(r.success).toBe(true);
  });

  test('accepts confirmOverlap true', () => {
    expect(createHolidaySchema.safeParse({ ...ok, confirmOverlap: true }).success).toBe(true);
  });
});

describe('patchHolidaySchema', () => {
  test.each<[string, Record<string, unknown>]>([
    ['title only', { title: 'New' }],
    ['clear the note', { note: null }],
    ['dates only', { startDate: '2026-10-01', endDate: '2026-10-02' }],
    ['audience only', { audience: [{ scopeType: 'SERIES', scopeId: 5 }] }],
    ['field plus confirmOverlap', { title: 'x', confirmOverlap: true }],
  ])('accepts %s', (_n, body) => {
    expect(patchHolidaySchema.safeParse(body).success).toBe(true);
  });

  test.each<[string, unknown]>([
    ['empty body', {}],
    ['only confirmOverlap', { confirmOverlap: true }],
    ['empty title', { title: '' }],
    ['empty audience', { audience: [] }],
    ['both dates, end before start', { startDate: '2026-10-05', endDate: '2026-10-04' }],
    ['bad date', { endDate: 'tomorrow' }],
  ])('rejects %s', (_n, body) => {
    expect(patchHolidaySchema.safeParse(body).success).toBe(false);
  });

  test('a single date is accepted here; the service checks it against the stored one', () => {
    expect(patchHolidaySchema.safeParse({ endDate: '2020-01-01' }).success).toBe(true);
  });
});

describe('checkOverlapSchema', () => {
  test('takes the create body plus an optional excludeId', () => {
    const r = checkOverlapSchema.safeParse({ ...ok, excludeId: 7 });
    expect(r.success && r.data.excludeId).toBe(7);
    expect(checkOverlapSchema.safeParse(ok).success).toBe(true);
  });

  test('rejects a bad excludeId and an end before start', () => {
    expect(checkOverlapSchema.safeParse({ ...ok, excludeId: 0 }).success).toBe(false);
    expect(
      checkOverlapSchema.safeParse({ ...ok, startDate: '2026-10-12', endDate: '2026-10-10' })
        .success,
    ).toBe(false);
  });
});
