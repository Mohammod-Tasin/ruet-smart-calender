import { describe, expect, test } from 'vitest';
import { layoutWeek } from '@/core/calendar/lanes';

// Week row Sat 2026-10-17 .. Fri 2026-10-23
const WEEK = ['17', '18', '19', '20', '21', '22', '23'].map((d) => `2026-10-${d}`);
const h = (id: string, startDate: string, endDate: string) => ({
  id,
  startDate: `2026-10-${startDate}`,
  endDate: `2026-10-${endDate}`,
});
const lanes = (items: ReturnType<typeof h>[], max?: number) =>
  Object.fromEntries(layoutWeek(WEEK, items, max).bars.map((b) => [b.item.id, b.lane]));

describe('layoutWeek', () => {
  test('no holidays', () => {
    expect(layoutWeek(WEEK, [])).toEqual({ bars: [], lanes: 0, more: [0, 0, 0, 0, 0, 0, 0] });
  });

  test('a multi-day holiday is one bar with column span', () => {
    const { bars } = layoutWeek(WEEK, [h('a', '17', '21')]);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ startCol: 0, endCol: 4, lane: 0 });
  });

  test('non-overlapping holidays share lane 0', () => {
    expect(lanes([h('a', '17', '18'), h('b', '20', '21')])).toEqual({ a: 0, b: 0 });
  });

  test('overlapping holidays stack', () => {
    expect(lanes([h('a', '17', '19'), h('b', '19', '21')])).toEqual({ a: 0, b: 1 });
  });

  test('same start: the longer one goes first', () => {
    expect(lanes([h('short', '17', '17'), h('long', '17', '20')])).toEqual({ long: 0, short: 1 });
  });

  test('a later bar drops into the lowest free lane', () => {
    // a: 17-23 (lane 0), b: 17-18 (lane 1), c: 19-20 can reuse lane 1
    expect(lanes([h('a', '17', '23'), h('b', '17', '18'), h('c', '19', '20')])).toEqual({
      a: 0,
      b: 1,
      c: 1,
    });
  });

  test('the same holiday stays on one lane across its days', () => {
    const l = layoutWeek(WEEK, [h('a', '17', '23'), h('b', '19', '19')]);
    expect(l.bars.filter((b) => b.item.id === 'a')).toHaveLength(1);
  });

  test('continuation flags when a holiday crosses the row', () => {
    const [b] = layoutWeek(WEEK, [h('a', '14', '19')]).bars;
    expect(b).toMatchObject({ startCol: 0, endCol: 2, continuesLeft: true, continuesRight: false });
    const [c] = layoutWeek(WEEK, [h('c', '22', '30')]).bars;
    expect(c).toMatchObject({ startCol: 5, endCol: 6, continuesLeft: false, continuesRight: true });
  });

  test('holidays outside the row are ignored', () => {
    expect(layoutWeek(WEEK, [h('a', '01', '16'), h('b', '24', '28')]).bars).toEqual([]);
  });

  test('max lanes hides the rest and counts them per day', () => {
    const items = [h('a', '17', '19'), h('b', '17', '19'), h('c', '18', '20'), h('d', '19', '19')];
    const l = layoutWeek(WEEK, items, 2);
    expect(l.bars.map((b) => b.item.id)).toEqual(['a', 'b']);
    expect(l.lanes).toBe(2);
    expect(l.more).toEqual([0, 1, 2, 1, 0, 0, 0]); // c on 18-20, d on 19
  });
});
