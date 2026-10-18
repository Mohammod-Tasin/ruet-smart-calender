import 'server-only';
import { and, desc, eq, gt } from 'drizzle-orm';
import { WINDOW_MS, type Attempt } from '@/core/auth/rate-limit';
import { getDb } from '@/server/db/client';
import { admins, loginAttempts } from '@/server/db/schema';

/** Recent attempts for the email+IP pair, and recent failures for the email from any IP. */
export async function getRecentAttempts(email: string, ip: string, now: Date) {
  const db = getDb();
  const since = new Date(now.getTime() - WINDOW_MS);
  const [emailIp, emailFailures] = await Promise.all([
    db
      .select({ success: loginAttempts.success, at: loginAttempts.at })
      .from(loginAttempts)
      .where(
        and(eq(loginAttempts.email, email), eq(loginAttempts.ip, ip), gt(loginAttempts.at, since)),
      )
      .orderBy(desc(loginAttempts.at))
      .limit(20),
    db
      .select({ success: loginAttempts.success, at: loginAttempts.at })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.email, email),
          eq(loginAttempts.success, false),
          gt(loginAttempts.at, since),
        ),
      )
      .orderBy(desc(loginAttempts.at))
      .limit(20), // enough to reach the 20-failure cap
  ]);
  return { emailIp: emailIp as Attempt[], email: emailFailures as Attempt[] };
}

export async function recordAttempt(email: string, ip: string, success: boolean): Promise<void> {
  await getDb().insert(loginAttempts).values({ email, ip, success });
}

export async function findAdminByEmail(email: string) {
  const [admin] = await getDb().select().from(admins).where(eq(admins.email, email));
  return admin ?? null;
}
