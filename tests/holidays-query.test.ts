import { describe, expect, test } from 'vitest';
import { parseHolidaysQuery } from '@/core/validation/holidays-query';

const parse = (qs: string) => parseHolidaysQuery(new URLSearchParams(qs));

describe('parseHolidaysQuery', () => {
  test.each([
    ['valid range', 'from=2026-01-01&to=2026-01-31'],
    ['same day', 'from=2026-03-05&to=2026-03-05'],
    ['exactly 400 days', 'from=2026-01-01&to=2027-02-05'],
    ['with series', 'from=2026-01-01&to=2026-01-31&series=7'],
    ['leap day', 'from=2028-02-29&to=2028-03-01'],
  ])('accepts %s', (_name, qs) => {
    expect(parse(qs).ok).toBe(true);
  });

  test.each([
    ['missing both', ''],
    ['missing to', 'from=2026-01-01'],
    ['not a date', 'from=hello&to=2026-01-31'],
    ['wrong format', 'from=01-01-2026&to=2026-01-31'],
    ['impossible date', 'from=2026-02-30&to=2026-03-10'],
    ['non-leap Feb 29', 'from=2027-02-29&to=2027-03-10'],
    ['month 13', 'from=2026-13-01&to=2026-13-02'],
    ['from after to', 'from=2026-02-01&to=2026-01-31'],
    ['401 days', 'from=2026-01-01&to=2027-02-06'],
    ['huge range', 'from=2000-01-01&to=2100-01-01'],
    ['series not a number', 'from=2026-01-01&to=2026-01-31&series=abc'],
    ['series zero', 'from=2026-01-01&to=2026-01-31&series=0'],
    ['series negative', 'from=2026-01-01&to=2026-01-31&series=-3'],
    ['series fractional', 'from=2026-01-01&to=2026-01-31&series=1.5'],
  ])('rejects %s', (_name, qs) => {
    const r = parse(qs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
  });

  test('returns typed values', () => {
    const r = parse('from=2026-01-01&to=2026-01-31&series=7');
    expect(r).toEqual({ ok: true, value: { from: '2026-01-01', to: '2026-01-31', series: 7 } });
  });
});
