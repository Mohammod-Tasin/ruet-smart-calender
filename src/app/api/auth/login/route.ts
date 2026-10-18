import { getClientIp } from '@/core/auth/client-ip';
import { sessionCookie } from '@/core/auth/cookie';
import { isEmailCapped, isRateLimited } from '@/core/auth/rate-limit';
import { loginSchema } from '@/core/validation/login';
import { findAdminByEmail, getRecentAttempts, recordAttempt } from '@/server/auth/login-attempts';
import { verifyPassword } from '@/server/auth/password';
import { cleanup, createSession } from '@/server/auth/session';
import { internalError, jsonError } from '@/server/http/errors';
import { guardMutation } from '@/server/http/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const guard = await guardMutation(req);
  if (!guard.ok) return guard.response;

  const parsed = loginSchema.safeParse(guard.body);
  if (!parsed.success) return jsonError(400, 'BAD_REQUEST', 'Email and password are required.');
  const { email, password } = parsed.data;
  const ip = getClientIp(req.headers);

  try {
    const now = new Date();
    const recent = await getRecentAttempts(email, ip, now);
    if (isRateLimited(recent.emailIp, now) || isEmailCapped(recent.email, now)) {
      // Blocked requests are not recorded, so hammering can't extend the lock.
      return jsonError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again later.', {
        'Retry-After': '900',
      });
    }

    const admin = await findAdminByEmail(email);
    const usable = admin && admin.isActive ? admin : null;
    const ok = await verifyPassword(usable?.passwordHash ?? null, password);
    await recordAttempt(email, ip, ok);
    if (!ok || !usable) {
      // Same answer for unknown email, wrong password and deactivated account.
      return jsonError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const token = await createSession(usable.id);
    cleanup().catch((e) => console.error(e)); // housekeeping must never fail a login

    const res = Response.json(
      {
        admin: {
          id: usable.id,
          name: usable.name,
          email: usable.email,
          role: usable.role,
          facultyId: usable.facultyId,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    res.headers.append('Set-Cookie', sessionCookie(token, process.env.NODE_ENV === 'production'));
    return res;
  } catch (e) {
    return internalError(e);
  }
}
