import { expect, test } from 'vitest';
import { GET } from '@/app/api/health/route';

test('GET /api/health returns ok, uncached', async () => {
  const res = GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers.get('Cache-Control')).toBe('no-store');
});
