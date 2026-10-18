import 'server-only';

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** Logs the real error server-side; clients only ever see a generic message. */
export function internalError(e: unknown): Response {
  console.error(e);
  return jsonError(500, 'INTERNAL', 'Something went wrong.');
}
