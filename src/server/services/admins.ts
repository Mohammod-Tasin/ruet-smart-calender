import 'server-only';
import { hash } from '@node-rs/argon2';
import { and, asc, eq } from 'drizzle-orm';
import type { AdminRole } from '@/core/auth/roles';
import type { CreateAdminInput, UpdateAdminInput } from '@/core/validation/admins';
import { getDb } from '@/server/db/client';
import { admins, sessions } from '@/server/db/schema';
import { auditEntity, fail, ok, type Result } from './shared';

export interface AdminSummary {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  createdAt: string;
}

const toSummary = (r: {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  createdAt: Date;
}): AdminSummary => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  isActive: r.isActive,
  createdAt: r.createdAt.toISOString(),
});

export async function listAdmins(): Promise<AdminSummary[]> {
  const rows = await getDb()
    .select({
      id: admins.id,
      name: admins.name,
      email: admins.email,
      role: admins.role,
      isActive: admins.isActive,
      createdAt: admins.createdAt,
    })
    .from(admins)
    .orderBy(asc(admins.id));
  return rows.map(toSummary);
}

export async function createAdminAccount(
  actorId: number,
  input: CreateAdminInput,
): Promise<Result<{ admin: AdminSummary }>> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hash(input.password);

  return getDb().transaction(async (tx) => {
    const [existing] = await tx.select().from(admins).where(eq(admins.email, email));
    if (existing) {
      if (existing.isActive) {
        return fail('CONFLICT', `An account with email ${email} already exists.`);
      }
      // Reactivate a previously removed account with the new details.
      const [updated] = await tx
        .update(admins)
        .set({
          name: input.name.trim(),
          passwordHash,
          role: input.role,
          isActive: true,
        })
        .where(eq(admins.id, existing.id))
        .returning({
          id: admins.id,
          name: admins.name,
          email: admins.email,
          role: admins.role,
          isActive: admins.isActive,
          createdAt: admins.createdAt,
        });
      await auditEntity(
        tx,
        actorId,
        'RESTORE',
        'ADMIN',
        existing.id,
        { role: existing.role, isActive: false },
        { role: updated!.role, isActive: true },
      );
      return ok({ admin: toSummary(updated!) });
    }

    const [created] = await tx
      .insert(admins)
      .values({
        name: input.name.trim(),
        email,
        passwordHash,
        role: input.role,
        isActive: true,
      })
      .returning({
        id: admins.id,
        name: admins.name,
        email: admins.email,
        role: admins.role,
        isActive: admins.isActive,
        createdAt: admins.createdAt,
      });

    await auditEntity(
      tx,
      actorId,
      'CREATE',
      'ADMIN',
      created!.id,
      null,
      { email: created!.email, role: created!.role },
    );
    return ok({ admin: toSummary(created!) });
  });
}

export async function updateAdminAccount(
  actorId: number,
  targetId: number,
  input: UpdateAdminInput,
): Promise<Result<{ admin: AdminSummary }>> {
  return getDb().transaction(async (tx) => {
    const [target] = await tx.select().from(admins).where(eq(admins.id, targetId));
    if (!target) return fail('NOT_FOUND', 'Admin account not found.');

    const nextRole = input.role ?? target.role;
    const nextActive = input.isActive ?? target.isActive;

    // Protect against locking yourself out or leaving the system with zero active moderators.
    if (targetId === actorId && (!nextActive || nextRole !== 'MODERATOR')) {
      return fail('UNPROCESSABLE', 'You cannot remove or demote your own Moderator account.');
    }

    const wasActiveMod = target.isActive && target.role === 'MODERATOR';
    const staysActiveMod = nextActive && nextRole === 'MODERATOR';
    if (wasActiveMod && !staysActiveMod) {
      const activeMods = await tx.$count(
        admins,
        and(eq(admins.isActive, true), eq(admins.role, 'MODERATOR')),
      );
      if (activeMods <= 1) {
        return fail('UNPROCESSABLE', 'At least one active Moderator is required.');
      }
    }

    const patch: Partial<typeof admins.$inferInsert> = {
      role: nextRole,
      isActive: nextActive,
    };
    if (input.password) {
      patch.passwordHash = await hash(input.password);
    }

    const [updated] = await tx
      .update(admins)
      .set(patch)
      .where(eq(admins.id, targetId))
      .returning({
        id: admins.id,
        name: admins.name,
        email: admins.email,
        role: admins.role,
        isActive: admins.isActive,
        createdAt: admins.createdAt,
      });

    // If deactivated, end their active sessions immediately.
    if (!nextActive) {
      await tx.delete(sessions).where(eq(sessions.adminId, targetId));
    }

    await auditEntity(
      tx,
      actorId,
      nextActive ? 'UPDATE' : 'DELETE',
      'ADMIN',
      targetId,
      { role: target.role, isActive: target.isActive },
      { role: updated!.role, isActive: updated!.isActive },
    );

    return ok({ admin: toSummary(updated!) });
  });
}

