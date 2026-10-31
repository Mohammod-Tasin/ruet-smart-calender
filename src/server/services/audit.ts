import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { admins, auditLog } from '@/server/db/schema';

/** Change history, newest first. Any admin may read it. No filter: the latest 100 changes. */
export async function listAudit(filter: { holidayId?: number; ruleId?: number } = {}) {
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
    .where(
      filter.ruleId !== undefined
        ? and(
            inArray(auditLog.entityType, ['RULE', 'RULE_OVERRIDE']),
            eq(auditLog.entityId, filter.ruleId),
          )
        : filter.holidayId === undefined
          ? undefined
          : eq(auditLog.holidayId, filter.holidayId),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(100);

  return rows.map(({ adminId, adminName, at, ...r }) => ({
    ...r,
    admin: { id: adminId, name: adminName },
    at: at.toISOString(),
  }));
}
