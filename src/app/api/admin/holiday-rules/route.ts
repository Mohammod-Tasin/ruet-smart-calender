import { z } from 'zod';
import { createRuleSchema } from '@/core/validation/rules';
import { internalError, jsonError } from '@/server/http/errors';
import { requireAdmin } from '@/server/http/guard';
import { adminMutation } from '@/server/http/mutation';
import { okJson } from '@/server/http/result';
import { createRule, listRules } from '@/server/services/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const yearParam = z.coerce.number().int().min(2000).max(2100);

// Rules, that year's computed dates, and the "dates needed" list.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const q = new URL(req.url).searchParams.get('year');
  const year = yearParam.safeParse(q ?? new Date().getUTCFullYear());
  if (!year.success) return jsonError(400, 'BAD_REQUEST', 'year must be 2000-2100.');
  try {
    return okJson(await listRules(year.data));
  } catch (e) {
    return internalError(e);
  }
}

export async function POST(req: Request) {
  return adminMutation(req, createRuleSchema, createRule, 201);
}
