import { formatIssues, patchHolidaySchema } from '@/core/validation/holiday';
import { internalError, jsonError } from '@/server/http/errors';
import { guardMutation, requireAdmin } from '@/server/http/guard';
import { failure, okJson, parseId } from '@/server/http/result';
import { deleteHoliday, getHoliday, updateHoliday } from '@/server/services/holidays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> }; // params is a Promise in this Next.js version

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');

  try {
    const result = await getHoliday(id);
    return result.ok ? okJson(result.value) : failure(result);
  } catch (e) {
    return internalError(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const guard = await guardMutation(req);
  if (!guard.ok) return guard.response;
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');

  const parsed = patchHolidaySchema.safeParse(guard.body);
  if (!parsed.success) return jsonError(400, 'BAD_REQUEST', formatIssues(parsed.error));

  try {
    const result = await updateHoliday(auth.admin.id, id, parsed.data);
    return result.ok ? okJson(result.value) : failure(result);
  } catch (e) {
    return internalError(e);
  }
}

// Soft delete: the row stays and can be restored.
export async function DELETE(req: Request, ctx: Ctx) {
  const guard = await guardMutation(req);
  if (!guard.ok) return guard.response;
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');

  try {
    const result = await deleteHoliday(auth.admin.id, id);
    return result.ok ? okJson(result.value) : failure(result);
  } catch (e) {
    return internalError(e);
  }
}
