import { describe, expect, it } from 'vitest';
import { verifyBatchSchema } from '@/core/validation/journey';
import { formatVerifiedParts, isVerifiedRecently } from '@/lib/journey-ui';

describe('batch verification helpers', () => {
  it('marks timestamps within 7 days as recent and older/missing as expired', () => {
    const now = Date.parse('2026-11-13T18:00:00Z');
    const oneHourAgo = new Date(now - 3_600_000).toISOString();
    const exactly7DaysAgo = new Date(now - 7 * 86_400_000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 86_400_000).toISOString();

    expect(isVerifiedRecently(oneHourAgo, now)).toBe(true);
    expect(isVerifiedRecently(exactly7DaysAgo, now)).toBe(true);
    expect(isVerifiedRecently(eightDaysAgo, now)).toBe(false);
    expect(isVerifiedRecently(undefined, now)).toBe(false);
    expect(isVerifiedRecently('not-a-date', now)).toBe(false);
  });

  it('formats verified date and time in Asia/Dhaka', () => {
    const parts = formatVerifiedParts('2026-11-13T17:37:00Z');
    expect(parts.date).toContain('Nov');
    expect(parts.time).toMatch(/11:37\s*PM/i);
  });

  it('validates verifyBatchSchema', () => {
    expect(verifyBatchSchema.safeParse({ intakeYear: 2023 }).success).toBe(true);
    expect(verifyBatchSchema.safeParse({ intakeYear: 1990 }).success).toBe(false);
    expect(verifyBatchSchema.safeParse({}).success).toBe(false);
  });
});

