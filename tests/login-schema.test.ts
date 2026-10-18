import { describe, expect, test } from 'vitest';
import { loginSchema } from '@/core/validation/login';

describe('loginSchema', () => {
  test('trims and lowercases the email', () => {
    const r = loginSchema.safeParse({ email: '  Admin@RUET.ac.bd ', password: 'x' });
    expect(r.success && r.data.email).toBe('admin@ruet.ac.bd');
  });

  test.each<[string, unknown]>([
    ['missing body', undefined],
    ['missing password', { email: 'a@b.c' }],
    ['missing email', { password: 'x' }],
    ['empty password', { email: 'a@b.c', password: '' }],
    ['email without @', { email: 'nope', password: 'x' }],
    ['email too long', { email: 'a'.repeat(251) + '@b.c', password: 'x' }],
    ['password too long', { email: 'a@b.c', password: 'x'.repeat(1025) }],
    ['non-string password', { email: 'a@b.c', password: 123 }],
  ])('rejects %s', (_n, body) => {
    expect(loginSchema.safeParse(body).success).toBe(false);
  });

  test('does not enforce a minimum password length at login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.c', password: 'x' }).success).toBe(true);
  });
});
