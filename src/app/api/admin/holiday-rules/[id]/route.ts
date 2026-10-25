import { endRuleSchema, patchRuleSchema } from '@/core/validation/rules';
import { jsonError } from '@/server/http/errors';
import { adminMutation } from '@/server/http/mutation';
import { parseId } from '@/server/http/result';
import { endRule, updateRule } from '@/server/services/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// Edit "from year onward" (body.fromYear).
export async function PATCH(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return adminMutation(req, patchRuleSchema, (admin, body) => updateRule(admin, id, body));
}

// End "from year onward" (body.fromYear).
export async function DELETE(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return adminMutation(req, endRuleSchema, (admin, body) => endRule(admin, id, body.fromYear));
}
