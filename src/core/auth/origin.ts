export type MutationCheck = { ok: true } | { ok: false; status: 403 | 415 | 500; message: string };

interface MutationInput {
  origin: string | null;
  contentType: string | null;
  appOrigin: string | undefined;
}

/** CSRF defence for state-changing requests: JSON content type + exact Origin match. */
export function checkMutation({ origin, contentType, appOrigin }: MutationInput): MutationCheck {
  let expected: string;
  try {
    expected = new URL(appOrigin ?? '').origin; // normalises case and trailing slash
  } catch {
    return { ok: false, status: 500, message: 'Server origin is not configured.' };
  }
  if (origin !== expected) return { ok: false, status: 403, message: 'Origin not allowed.' };

  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    return { ok: false, status: 415, message: 'Content-Type must be application/json.' };
  }
  return { ok: true };
}
