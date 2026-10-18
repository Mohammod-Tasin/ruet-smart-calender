import 'server-only';

/** Error responses are never cacheable. */
export function jsonError(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );
}

/** Logs the real error server-side; clients only ever see a generic message. */
export function internalError(e: unknown): Response {
  console.error(e);
  return jsonError(500, 'INTERNAL', 'Something went wrong.');
}
