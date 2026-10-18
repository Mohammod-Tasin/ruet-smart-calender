import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { admins, auditLog } from '@/server/db/schema';

/** Change history, newest first. Any admin may read it. */
export async function listAudit(holidayId?: number) {
  const rows = await getDb()
    .select({
      id: auditLog.id,
      action: auditLog.action,
      holidayId: auditLog.holidayId,
      adminId: auditLog.adminId,
      adminName: admins.name,
      before: auditLog.before,
      after: auditLog.after,
      at: auditLog.at,
    })
    .from(auditLog)
    .innerJoin(admins, eq(admins.id, auditLog.adminId))
    .where(holidayId === undefined ? undefined : eq(auditLog.holidayId, holidayId))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(100);

  return rows.map(({ adminId, adminName, at, ...r }) => ({
    ...r,
    admin: { id: adminId, name: adminName },
    at: at.toISOString(),
  }));
}
