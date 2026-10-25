import { clearWeekOverrideSchema, weekOverrideSchema } from '@/core/validation/semesters';
import { jsonError } from '@/server/http/errors';
import { adminMutation } from '@/server/http/mutation';
import { parseId } from '@/server/http/result';
import { clearWeekOverride, setWeekOverride } from '@/server/services/semesters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// FORCE_EXTEND (skip this week) or NO_EXTEND (count it even if fully off).
export async function PUT(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return adminMutation(req, weekOverrideSchema, (admin, body) => setWeekOverride(admin, id, body));
}

export async function DELETE(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return adminMutation(req, clearWeekOverrideSchema, (admin, body) =>
    clearWeekOverride(admin, id, body.weekStart),
  );
}
