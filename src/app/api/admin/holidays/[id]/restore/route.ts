import { internalError, jsonError } from '@/server/http/errors';
import { guardMutation, requireAdmin } from '@/server/http/guard';
import { failure, okJson, parseId } from '@/server/http/result';
import { restoreHoliday } from '@/server/services/holidays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(req);
  if (!guard.ok) return guard.response;
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');

  try {
    const result = await restoreHoliday(auth.admin.id, id);
    return result.ok ? okJson(result.value) : failure(result);
  } catch (e) {
    return internalError(e);
  }
}
