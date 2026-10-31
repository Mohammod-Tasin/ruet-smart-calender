import { occurrenceSchema } from '@/core/validation/rules';
import { jsonError } from '@/server/http/errors';
import { adminMutation } from '@/server/http/mutation';
import { parseId } from '@/server/http/result';
import { changeOccurrence } from '@/server/services/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// "Change date" on one yearly holiday: only this year, or from this / next year on.
// The time rules are enforced in the service; `today` is never taken from the client.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return adminMutation(req, occurrenceSchema, (admin, body) => changeOccurrence(admin, id, body));
}
