import { expect, test } from 'vitest';
import { toDirectUrl, toPooledUrl } from '../scripts/lib/db-url';

const pooled =
  'postgresql://u:p@ep-cool-1234-pooler.ap-southeast-1.aws.neon.tech/db?sslmode=require';
const direct = 'postgresql://u:p@ep-cool-1234.ap-southeast-1.aws.neon.tech/db?sslmode=require';

test('toDirectUrl removes -pooler from the host only', () => {
  expect(toDirectUrl(pooled)).toBe(direct);
  expect(toDirectUrl(direct)).toBe(direct);
});

test('toPooledUrl adds -pooler once', () => {
  expect(toPooledUrl(direct)).toBe(pooled);
  expect(toPooledUrl(pooled)).toBe(pooled);
});
