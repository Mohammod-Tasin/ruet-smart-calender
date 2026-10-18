import { describe, expect, test } from 'vitest';
import { getClientIp } from '@/core/auth/client-ip';

const h = (o: Record<string, string>) => new Headers(o);

describe('getClientIp', () => {
  test.each<[string, Record<string, string>, string]>([
    ['no headers', {}, 'unknown'],
    ['vercel header only', { 'x-vercel-forwarded-for': '203.0.113.5' }, '203.0.113.5'],
    ['x-real-ip only', { 'x-real-ip': '198.51.100.7' }, '198.51.100.7'],
    ['x-forwarded-for only', { 'x-forwarded-for': '192.0.2.1' }, '192.0.2.1'],
    [
      'vercel beats the others',
      {
        'x-vercel-forwarded-for': '203.0.113.5',
        'x-real-ip': '198.51.100.7',
        'x-forwarded-for': '192.0.2.1',
      },
      '203.0.113.5',
    ],
    [
      'x-real-ip beats x-forwarded-for',
      { 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '192.0.2.1' },
      '198.51.100.7',
    ],
    [
      'first entry of x-forwarded-for',
      { 'x-forwarded-for': '192.0.2.1, 10.0.0.1, 10.0.0.2' },
      '192.0.2.1',
    ],
    ['trims whitespace', { 'x-forwarded-for': '  192.0.2.1  ,10.0.0.1' }, '192.0.2.1'],
    ['IPv6', { 'x-vercel-forwarded-for': '2001:db8::1' }, '2001:db8::1'],
    [
      'junk vercel header falls through',
      { 'x-vercel-forwarded-for': 'hello', 'x-real-ip': '198.51.100.7' },
      '198.51.100.7',
    ],
    [
      'empty header falls through',
      { 'x-real-ip': '', 'x-forwarded-for': '192.0.2.1' },
      '192.0.2.1',
    ],
    ['too long is rejected', { 'x-forwarded-for': '1'.repeat(60) + '.1' }, 'unknown'],
    ['markup is rejected', { 'x-forwarded-for': '<script>1.1</script>' }, 'unknown'],
  ])('%s', (_n, headers, expected) => {
    expect(getClientIp(h(headers))).toBe(expected);
  });
});
