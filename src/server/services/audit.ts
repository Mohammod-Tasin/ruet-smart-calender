import 'server-only';
import { and, desc, eq, like, type SQL } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { admins, auditLog } from '@/server/db/schema';

/**
 * Change history, newest first. Any admin may read it.
 * `holidayId`: one holiday. `semesterId`: everything done to one semester (its checkpoints,
 * week overrides and pins too). Neither: the latest changes overall.
 */
export async function listAudit(filter: { holidayId?: number; semesterId?: number } = {}) {
  const conditions: SQL[] = [];
  if (filter.holidayId !== undefined) conditions.push(eq(auditLog.holidayId, filter.holidayId));
  if (filter.semesterId !== undefined) {
    conditions.push(
      like(auditLog.entityType, 'SEMESTER%'),
      eq(auditLog.entityId, filter.semesterId),
    );
  }
  const rows = await getDb()
    .select({
      id: auditLog.id,
      action: auditLog.action,
      holidayId: auditLog.holidayId,
      entityType: auditLog.entityType,
      adminId: auditLog.adminId,
      adminName: admins.name,
      before: auditLog.before,
      after: auditLog.after,
      at: auditLog.at,
    })
    .from(auditLog)
    .innerJoin(admins, eq(admins.id, auditLog.adminId))
    .where(and(...conditions))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(100);

  return rows.map(({ adminId, adminName, at, ...r }) => ({
    ...r,
    admin: { id: adminId, name: adminName },
    at: at.toISOString(),
  }));
}
