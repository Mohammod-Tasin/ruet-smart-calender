import 'server-only';
import type { z } from 'zod';
import { formatIssues } from '@/core/validation/holiday';
import { internalError, jsonError } from './errors';
import { guardMutation, requireAdmin } from './guard';
import { failure, okJson } from './result';
import type { Result } from '@/server/services/shared';

/**
 * The thin admin write route in one place: guard -> admin -> zod -> service -> JSON.
 * `run` gets the admin id and the parsed body.
 */
export async function adminMutation<S extends z.ZodType>(
  req: Request,
  schema: S,
  run: (adminId: number, body: z.infer<S>) => Promise<Result<unknown>>,
  status = 200,
): Promise<Response> {
  const guard = await guardMutation(req);
  if (!guard.ok) return guard.response;
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(guard.body);
  if (!parsed.success) return jsonError(400, 'BAD_REQUEST', formatIssues(parsed.error));
  try {
    const result = await run(auth.admin.id, parsed.data);
    return result.ok ? okJson(result.value, status) : failure(result);
  } catch (e) {
    return internalError(e);
  }
}
