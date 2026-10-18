import { checkOverlapSchema, formatIssues } from '@/core/validation/holiday';
import { internalError, jsonError } from '@/server/http/errors';
import { guardMutation, requireAdmin } from '@/server/http/guard';
import { failure, okJson } from '@/server/http/result';
import { checkOverlap } from '@/server/services/holidays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST because it takes the same body as creating; it saves nothing.
export async function POST(req: Request) {
  const guard = await guardMutation(req);
  if (!guard.ok) return guard.response;
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const parsed = checkOverlapSchema.safeParse(guard.body);
  if (!parsed.success) return jsonError(400, 'BAD_REQUEST', formatIssues(parsed.error));

  try {
    const result = await checkOverlap(parsed.data);
    return result.ok ? okJson(result.value) : failure(result);
  } catch (e) {
    return internalError(e);
  }
}
