import { createAdminSchema } from '@/core/validation/admins';
import { internalError } from '@/server/http/errors';
import { requireModerator } from '@/server/http/guard';
import { moderatorMutation } from '@/server/http/mutation';
import { okJson } from '@/server/http/result';
import { createAdminAccount, listAdmins } from '@/server/services/admins';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireModerator(req);
  if (!auth.ok) return auth.response;
  try {
    return okJson({ admins: await listAdmins() });
  } catch (e) {
    return internalError(e);
  }
}

export async function POST(req: Request) {
  return moderatorMutation(req, createAdminSchema, createAdminAccount, 201);
}

