import { describe, expect, it } from 'vitest';
import { needsTrim, trimOffDays } from '@/core/calendar/trim';

const THU_FRI = [4, 5];

describe('trimOffDays', () => {
  it.each([
    // 2027-05-13 is a Thursday, 2027-05-21 a Friday
    ['13 May Thu .. 21 May Fri', '2027-05-13', '2027-05-21', '2027-05-15', '2027-05-19'],
    ['starts Thursday only', '2027-10-07', '2027-10-13', '2027-10-09', '2027-10-13'],
    ['ends Friday only', '2027-10-09', '2027-10-15', '2027-10-09', '2027-10-13'],
    ['nothing to trim', '2027-02-08', '2027-02-17', '2027-02-08', '2027-02-17'],
    ['single working day', '2027-01-06', '2027-01-06', '2027-01-06', '2027-01-06'],
  ])('%s', (_n, s, e, rs, re) => {
    expect(trimOffDays({ startDate: s, endDate: e }, THU_FRI)).toEqual({
      startDate: rs,
      endDate: re,
    });
  });

  it('keeps off days inside the range', () => {
    // Sat 2027-03-06 .. Wed 2027-03-17 contains a Thu/Fri pair in the middle
    const r = { startDate: '2027-03-06', endDate: '2027-03-17' };
    expect(trimOffDays(r, THU_FRI)).toEqual(r);
  });

  it('returns null when the whole range is weekly off', () => {
    expect(trimOffDays({ startDate: '2027-05-13', endDate: '2027-05-14' }, THU_FRI)).toBeNull();
    expect(trimOffDays({ startDate: '2027-05-14', endDate: '2027-05-14' }, THU_FRI)).toBeNull();
  });

  it('needsTrim', () => {
    expect(needsTrim({ startDate: '2027-05-13', endDate: '2027-05-19' }, THU_FRI)).toBe(true);
    expect(needsTrim({ startDate: '2027-05-15', endDate: '2027-05-21' }, THU_FRI)).toBe(true);
    expect(needsTrim({ startDate: '2027-05-15', endDate: '2027-05-19' }, THU_FRI)).toBe(false);
  });
});
