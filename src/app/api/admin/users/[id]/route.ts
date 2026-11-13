import { z } from 'zod';
import { updateAdminSchema } from '@/core/validation/admins';
import { jsonError } from '@/server/http/errors';
import { moderatorMutation } from '@/server/http/mutation';
import { parseId } from '@/server/http/result';
import { updateAdminAccount } from '@/server/services/admins';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return moderatorMutation(req, updateAdminSchema, (actor, body) =>
    updateAdminAccount(actor, id, body),
  );
}

// Deactivate (remove access) and end active sessions.
export async function DELETE(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return moderatorMutation(req, z.any(), (actor) =>
    updateAdminAccount(actor, id, { isActive: false }),
  );
}

