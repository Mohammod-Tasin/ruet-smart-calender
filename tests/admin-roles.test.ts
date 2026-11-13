import { describe, expect, it } from 'vitest';
import { ADMIN_HOLIDAY_CATEGORY, ADMIN_ROLES, isModerator } from '@/core/auth/roles';
import { createAdminSchema, updateAdminSchema } from '@/core/validation/admins';

describe('admin roles', () => {
  it('recognizes MODERATOR and rejects ADMIN / empty', () => {
    expect(ADMIN_ROLES).toEqual(['MODERATOR', 'ADMIN']);
    expect(isModerator('MODERATOR')).toBe(true);
    expect(isModerator('ADMIN')).toBe(false);
    expect(isModerator(undefined)).toBe(false);
    expect(isModerator(null)).toBe(false);
    expect(ADMIN_HOLIDAY_CATEGORY).toBe('UNOFFICIAL_BREAK');
  });
});

describe('admin validation schemas', () => {
  it('validates createAdminSchema with default ADMIN role', () => {
    const res = createAdminSchema.safeParse({
      name: 'Test Admin',
      email: 'test@ruet.ac.bd',
      password: 'strongpassword123',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.role).toBe('ADMIN');
    }
  });

  it('rejects short passwords and invalid emails', () => {
    expect(
      createAdminSchema.safeParse({ name: 'A', email: 'not-an-email', password: 'password123' })
        .success,
    ).toBe(false);
    expect(
      createAdminSchema.safeParse({ name: 'A', email: 'a@b.com', password: 'short' }).success,
    ).toBe(false);
  });

  it('requires at least one field in updateAdminSchema', () => {
    expect(updateAdminSchema.safeParse({}).success).toBe(false);
    expect(updateAdminSchema.safeParse({ role: 'MODERATOR' }).success).toBe(true);
    expect(updateAdminSchema.safeParse({ isActive: false }).success).toBe(true);
  });
});

