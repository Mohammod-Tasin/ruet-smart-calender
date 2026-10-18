import { describe, expect, test } from 'vitest';
import { isEmailCapped, isRateLimited, type Attempt } from '@/core/auth/rate-limit';

const now = new Date('2026-10-18T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const fail = (minutes: number): Attempt => ({ success: false, at: ago(minutes) });
const ok = (minutes: number): Attempt => ({ success: true, at: ago(minutes) });
const fails = (n: number, startMinutes = 1): Attempt[] =>
  Array.from({ length: n }, (_, i) => fail(startMinutes + i * 0.1));

describe('isRateLimited (per email+IP)', () => {
  test.each<[string, Attempt[], boolean]>([
    ['no attempts', [], false],
    ['4 recent failures', fails(4), false],
    ['5 recent failures', fails(5), true],
    ['10 recent failures', fails(10), true],
    ['5 failures but all older than 15 min', fails(5, 16), false],
    ['exactly 15 min old does not count', [fail(15), ...fails(4)], false],
    ['just under 15 min old counts', [fail(14.9), ...fails(4)], true],
    ['success after 5 failures resets', [...fails(5, 5), ok(1)], false],
    ['4 failures, success, 4 failures', [...fails(4, 10), ok(5), ...fails(4, 1)], false],
    ['success then 5 failures', [ok(10), ...fails(5, 1)], true],
    ['success is older than failures run', [ok(14), ...fails(5, 1)], true],
    [
      'unsorted input is handled',
      [fail(1), ok(8), fail(2), fail(3), fail(4), fail(5), fail(6)],
      true,
    ],
  ])('%s', (_n, attempts, expected) => {
    expect(isRateLimited(attempts, now)).toBe(expected);
  });
});

describe('isEmailCapped (per email, any IP)', () => {
  test.each<[string, Attempt[], boolean]>([
    ['no attempts', [], false],
    ['19 recent failures', fails(19), false],
    ['20 recent failures', fails(20), true],
    ['25 recent failures', fails(25), true],
    ['20 failures but 5 are older than 15 min', [...fails(15), ...fails(5, 20)], false],
    ['a success does NOT reset the cap', [...fails(20), ok(0.5)], true],
    [
      'successes do not count as failures',
      [...fails(19), ...Array.from({ length: 10 }, () => ok(1))],
      false,
    ],
    ['exactly 15 min old does not count', [fail(15), ...fails(19)], false],
  ])('%s', (_n, attempts, expected) => {
    expect(isEmailCapped(attempts, now)).toBe(expected);
  });

  test('per-IP and per-email limits are independent', () => {
    // 5 failures from one IP: the IP limit trips, the email cap does not.
    expect(isRateLimited(fails(5), now)).toBe(true);
    expect(isEmailCapped(fails(5), now)).toBe(false);
  });
});
