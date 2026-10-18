export const SESSION_COOKIE = 'rc_session';
export const SESSION_MAX_AGE_SECONDS = 604_800; // 7 days

function build(value: string, maxAge: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

export const sessionCookie = (token: string, secure: boolean) =>
  build(token, SESSION_MAX_AGE_SECONDS, secure);

export const clearedSessionCookie = (secure: boolean) => build('', 0, secure);

/** Reads one cookie from a `Cookie` request header. */
export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}
