import 'server-only';
import { SESSION_COOKIE, readCookie } from '@/core/auth/cookie';
import { checkMutation } from '@/core/auth/origin';
import { findSession, type AdminSession } from '@/server/auth/session';
import { jsonError } from './errors';

const MAX_BODY_BYTES = 64 * 1024;

type Guarded<T> = ({ ok: true } & T) | { ok: false; response: Response };

/**
 * Run first in every state-changing route: Origin + Content-Type (CSRF defence), body size
 * limit, JSON parsing. An empty body is allowed and parsed as `undefined`.
 */
export async function guardMutation(req: Request): Promise<Guarded<{ body: unknown }>> {
  const check = checkMutation({
    origin: req.headers.get('origin'),
    contentType: req.headers.get('content-type'),
    appOrigin: process.env.APP_ORIGIN,
  });
  if (!check.ok) {
    return { ok: false, response: jsonError(check.status, 'FORBIDDEN', check.message) };
  }

  const declared = Number(req.headers.get('content-length') ?? 0);
  const tooBig = () => ({
    ok: false as const,
    response: jsonError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'),
  });
  if (declared > MAX_BODY_BYTES) return tooBig();

  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return tooBig(); // header can lie or be absent
  if (text === '') return { ok: true, body: undefined };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: jsonError(400, 'BAD_REQUEST', 'Body must be valid JSON.') };
  }
}

/**
 * Session guard for admin routes:
 *   const auth = await requireAdmin(req);
 *   if (!auth.ok) return auth.response;
 *   // auth.admin is the signed-in admin
 */
export async function requireAdmin(req: Request): Promise<Guarded<{ admin: AdminSession }>> {
  const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
  const admin = token ? await findSession(token) : null;
  if (!admin) {
    return { ok: false, response: jsonError(401, 'UNAUTHENTICATED', 'Please sign in.') };
  }
  return { ok: true, admin };
}
