import { SESSION_COOKIE, clearedSessionCookie, readCookie } from '@/core/auth/cookie';
import { deleteSession } from '@/server/auth/session';
import { internalError } from '@/server/http/errors';
import { guardMutation } from '@/server/http/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const guard = await guardMutation(req);
  if (!guard.ok) return guard.response;

  try {
    const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
    if (token) await deleteSession(token);

    const res = Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    res.headers.append('Set-Cookie', clearedSessionCookie(process.env.NODE_ENV === 'production'));
    return res;
  } catch (e) {
    return internalError(e);
  }
}
