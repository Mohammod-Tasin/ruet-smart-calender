import 'server-only';
import { and, eq, gt, lt } from 'drizzle-orm';
import { SESSION_MAX_AGE_SECONDS } from '@/core/auth/cookie';
import { generateToken, hashToken } from '@/core/auth/token';
import { getDb } from '@/server/db/client';
import { admins, loginAttempts, sessions } from '@/server/db/schema';

export interface AdminSession {
  id: number;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'FACULTY_ADMIN';
  facultyId: number | null;
}

/** Creates a session and returns the RAW token (for the cookie). Only its hash is stored. */
export async function createSession(adminId: number): Promise<string> {
  const token = generateToken();
  await getDb()
    .insert(sessions)
    .values({
      tokenHash: hashToken(token),
      adminId,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    });
  return token;
}

/** The admin for a raw token, or null if unknown, expired, or the admin is deactivated. */
export async function findSession(token: string): Promise<AdminSession | null> {
  const [row] = await getDb()
    .select({
      id: admins.id,
      name: admins.name,
      email: admins.email,
      role: admins.role,
      facultyId: admins.facultyId,
    })
    .from(sessions)
    .innerJoin(admins, eq(admins.id, sessions.adminId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        eq(admins.isActive, true),
      ),
    );
  return row ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await getDb()
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)));
}

/** Housekeeping on login: drop expired sessions and login attempts older than a day. */
export async function cleanup(): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  await db.delete(loginAttempts).where(lt(loginAttempts.at, new Date(Date.now() - 86_400_000)));
}
