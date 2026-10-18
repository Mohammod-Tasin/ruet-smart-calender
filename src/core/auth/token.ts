import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes from the OS CSPRNG, base64url. This is what goes in the cookie. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 hex. Only this hash is stored in the DB, never the raw token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
