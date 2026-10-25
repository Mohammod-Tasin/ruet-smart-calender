import { describe, expect, test } from 'vitest';
import {
  applyChange,
  diffTimelines,
  groupImpacts,
  milestones,
  type OffItem,
} from '@/core/semester/impact';
import { computeTimeline, DEFAULT_TEMPLATE } from '@/core/semester/timeline';

const tl = (...ranges: [string, string][]) =>
  computeTimeline({
    startDate: '2026-10-03',
    template: DEFAULT_TEMPLATE,
    isOffDay: (d) => ranges.some(([s, e]) => s <= d && d <= e),
  });

describe('diffTimelines', () => {
  test('no change', () => {
    expect(diffTimelines(tl(), tl())).toBeNull();
    // a partial week changes nothing
    expect(diffTimelines(tl(), tl(['2026-10-17', '2026-10-18']))).toBeNull();
  });

  test('a full week off moves everything after it by one week', () => {
    const d = diffTimelines(tl(), tl(['2026-10-17', '2026-10-21']))!;
    expect(d.endShiftWeeks).toBe(1);
    expect(d.changes).toEqual([
      { segment: 1, phase: 'MID_BREAK', before: '2026-11-21', after: '2026-11-28' },
      { segment: 2, phase: 'CLASS', before: '2026-11-28', after: '2026-12-05' },
      { segment: 3, phase: 'VIVA', before: '2027-01-09', after: '2027-01-16' },
      { segment: 4, phase: 'FINALS', before: '2027-01-16', after: '2027-01-23' },
    ]);
  });

  test('a late holiday only moves the late phases', () => {
    const d = diffTimelines(tl(), tl(['2027-01-16', '2027-01-20']))!;
    expect(d.changes).toEqual([
      { segment: 4, phase: 'FINALS', before: '2027-01-16', after: '2027-01-23' },
    ]);
    expect(d.endShiftWeeks).toBe(1);
  });

  test('removing a holiday moves things earlier', () => {
    const d = diffTimelines(tl(['2026-10-17', '2026-10-21']), tl())!;
    expect(d.endShiftWeeks).toBe(-1);
    expect(d.changes[0]).toMatchObject({ before: '2026-11-28', after: '2026-11-21' });
  });

  test('milestones are the first counted week of each block', () => {
    expect(milestones(tl()).map((m) => m.date)).toEqual([
      '2026-10-03',
      '2026-11-21',
      '2026-11-28',
      '2027-01-09',
      '2027-01-16',
    ]);
  });
});

describe('groupImpacts', () => {
  test('series with the same effect are reported together', () => {
    const shifted = diffTimelines(tl(), tl(['2026-10-17', '2026-10-21']))!;
    const later = diffTimelines(tl(), tl(['2027-01-16', '2027-01-20']))!;
    const groups = groupImpacts([
      { seriesId: 1, label: 'EEE-21', diff: shifted },
      { seriesId: 2, label: 'EEE-22', diff: shifted },
      { seriesId: 3, label: 'CSE-23', diff: later },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ labels: ['EEE-21', 'EEE-22'], seriesIds: [1, 2] });
    expect(groups[0]!.endShiftWeeks).toBe(1);
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
