import 'server-only';
import { hash, verify } from '@node-rs/argon2'; // argon2id by default

let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hash('timing-equaliser-not-a-real-password'));

/**
 * Pass `null` when there is no usable account: we still run a full argon2 verify against a
 * dummy hash, so "unknown email" takes as long as "wrong password" and can't be told apart.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (storedHash === null) {
    await verify(await dummyHash(), password).catch(() => false);
    return false;
  }
  try {
    return await verify(storedHash, password);
  } catch {
    return false; // malformed stored hash must not become a 500 that reveals the account
  }
}
