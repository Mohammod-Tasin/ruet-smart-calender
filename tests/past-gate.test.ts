import { describe, expect, test, vi } from 'vitest';
import type { Structure } from '@/core/calendar/types';

vi.mock('server-only', () => ({}));
const { pastGate } = await import('@/server/services/shared');

// The server-side "Fix a past holiday" gate, with a fixed "today" and a stub database that
// answers "which of these series have a saved semester history?".
const structure: Structure = {
  faculties: [{ id: 1, code: 'F', sortOrder: 1 }],
  departments: [{ id: 1, facultyId: 1, code: 'CSE' }],
  series: [21, 22, 23].map((yy) => ({
    id: yy,
    departmentId: 1,
    intakeYear: 2000 + yy,
    isActive: true,
  })),
};
const db = (withHistory: number[]) => {
  const calls: number[][] = [];
  const x = {
    selectDistinct: () => ({
      from: () => ({
        where: async () => (calls.push(withHistory), withHistory.map((id) => ({ id }))),
      }),
    }),
  };
  return { x: x as never, calls };
};
const d = (startDate: string, endDate = startDate) => ({ startDate, endDate });
const ALL = [{ scopeType: 'ALL' as const, scopeId: null }];
const today = '2026-12-15';

describe('pastGate', () => {
  test('a future holiday goes through without touching the database', async () => {
    const { x, calls } = db([21]);
    expect(
      await pastGate(x, structure, { today, ranges: [d('2026-12-20')], audiences: [ALL] }),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('touching the past is refused with the series count', async () => {
    const { x } = db([21, 22]);
    const r = await pastGate(x, structure, { today, ranges: [d('2026-12-10')], audiences: [ALL] });
    expect(r).toMatchObject({
      ok: false,
      code: 'PAST_CONFIRM',
      message:
        'This holiday is in the past. Changing it recalculates the semester history of 2 series.',
    });
  });

  test('the new range counts too, not only the old one', async () => {
    const { x } = db([23]);
    const r = await pastGate(x, structure, {
      today,
      ranges: [d('2026-12-20'), d('2026-12-14', '2026-12-20')],
      audiences: [ALL],
    });
    expect(r).toMatchObject({ ok: false, code: 'PAST_CONFIRM' });
  });

  test('confirmed goes through', async () => {
    const { x } = db([21]);
    expect(
      await pastGate(x, structure, {
        today,
        ranges: [d('2026-12-10')],
        audiences: [ALL],
        confirmed: true,
      }),
    ).toBeNull();
  });

  test('"today" decides: the same range is fine the day before it starts', async () => {
    const { x } = db([21]);
    const range = [d('2026-12-16', '2026-12-18')];
    expect(
      await pastGate(x, structure, { today: '2026-12-15', ranges: range, audiences: [ALL] }),
    ).toBeNull();
    expect(
      await pastGate(x, structure, { today: '2026-12-17', ranges: range, audiences: [ALL] }),
    ).toMatchObject({
      code: 'PAST_CONFIRM',
    });
  });

  test('an audience with no series asks nothing of the database but still needs the confirm', async () => {
    const { x, calls } = db([]);
    const r = await pastGate(x, structure, {
      today,
      ranges: [d('2026-12-10')],
      audiences: [[{ scopeType: 'SERIES', scopeId: 999 }]],
    });
    expect(r).toMatchObject({
      code: 'PAST_CONFIRM',
      message: expect.stringContaining('does not move any series'),
    });
    expect(calls).toHaveLength(0);
  });
});
