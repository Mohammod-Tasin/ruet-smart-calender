import { clearPinSchema, pinSchema } from '@/core/validation/semesters';
import { jsonError } from '@/server/http/errors';
import { adminMutation } from '@/server/http/mutation';
import { parseId } from '@/server/http/result';
import { clearPin, setPin } from '@/server/services/semesters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// "<phase> starts on <date>", whatever the computation says.
export async function PUT(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return adminMutation(req, pinSchema, (admin, body) => setPin(admin, id, body));
}

export async function DELETE(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return adminMutation(req, clearPinSchema, (admin, body) => clearPin(admin, id, body.phase));
}
