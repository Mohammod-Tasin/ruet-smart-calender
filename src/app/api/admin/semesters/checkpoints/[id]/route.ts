import { z } from 'zod';
import { jsonError } from '@/server/http/errors';
import { adminMutation } from '@/server/http/mutation';
import { parseId } from '@/server/http/result';
import { deleteCheckpoint } from '@/server/services/semesters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  return adminMutation(req, z.any(), (admin) => deleteCheckpoint(admin, id));
}
