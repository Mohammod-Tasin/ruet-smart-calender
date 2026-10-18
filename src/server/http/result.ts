import 'server-only';
import type { ServiceError } from '@/server/services/holidays';

const STATUS = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  NOT_DELETED: 409,
  OVERLAP: 409,
  UNPROCESSABLE: 422,
} as const;

/** Success response for admin routes: never cached. */
export function okJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Maps a service failure to the `{ error: { code, message } }` shape (+ conflicts on 409). */
export function failure(e: ServiceError): Response {
  const error = { code: e.code, message: e.message };
  return Response.json(e.code === 'OVERLAP' ? { error, conflicts: e.conflicts ?? [] } : { error }, {
    status: STATUS[e.code],
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** Strict positive-integer id from a URL segment, or null. */
export function parseId(raw: string): number | null {
  return /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : null;
}
