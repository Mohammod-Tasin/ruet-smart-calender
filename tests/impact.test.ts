import { describe, expect, test } from 'vitest';
import { applyChange, groupImpacts, type JourneyDiff, type OffItem } from '@/core/journey/impact';

const diff = (endShiftWeeks: number): JourneyDiff => ({ endShiftWeeks, changes: [] });

describe('groupImpacts', () => {
  test('series with the same effect are reported together, biggest shift first', () => {
    const groups = groupImpacts([
      { seriesId: 3, label: 'CSE-23', diff: diff(2) },
      { seriesId: 1, label: 'EEE-21', diff: diff(1) },
      { seriesId: 2, label: 'EEE-22', diff: diff(1) },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ labels: ['CSE-23'], endShiftWeeks: 2 });
    expect(groups[1]).toMatchObject({ labels: ['EEE-21', 'EEE-22'], seriesIds: [1, 2] });
  });

  test('nothing affected, nothing reported', () => {
    expect(groupImpacts([])).toEqual([]);
  });
});

describe('applyChange', () => {
  const all = [{ scopeType: 'ALL' as const, scopeId: null }];
  const items: OffItem[] = [
    { id: 1, title: 'a', startDate: '2026-10-01', endDate: '2026-10-01', audience: all },
    {
      id: 'rule:3:2026',
      title: 'b',
      startDate: '2026-10-17',
      endDate: '2026-10-21',
      audience: all,
    },
  ];

  test('removes by number or rule id, and adds', () => {
    const out = applyChange(items, {
      removeIds: [1, 'rule:3:2026'],
      add: [{ startDate: '2026-11-01', endDate: '2026-11-02', audience: all }],
    });
    expect(out.map((x) => x.startDate)).toEqual(['2026-11-01']);
    expect(out[0]!.id).toBe('proposed:0');
  });

  test('an empty change keeps everything', () => {
    expect(applyChange(items, {})).toEqual(items);
  });
});
