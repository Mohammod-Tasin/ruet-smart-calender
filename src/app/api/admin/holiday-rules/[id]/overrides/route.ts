import { clearOverrideSchema, overrideSchema } from '@/core/validation/rules';
import { jsonError } from '@/server/http/errors';
import { adminMutation } from '@/server/http/mutation';
import { parseId } from '@/server/http/result';
import { clearOverride, setOverride } from '@/server/services/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// Create or change one year's override: move dates, skip, or confirm.
export async function PUT(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return adminMutation(req, overrideSchema, (admin, body) => setOverride(admin, id, body));
}

// Remove one year's override.
export async function DELETE(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return adminMutation(req, clearOverrideSchema, (admin, body) =>
    clearOverride(admin, id, body.year, { confirmPast: body.confirmPast }),
  );
}
