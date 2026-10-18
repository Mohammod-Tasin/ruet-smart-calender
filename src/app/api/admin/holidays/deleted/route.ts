import { internalError } from '@/server/http/errors';
import { requireAdmin } from '@/server/http/guard';
import { okJson } from '@/server/http/result';
import { listDeleted } from '@/server/services/holidays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Soft-deleted holidays, so the admin UI can offer "restore".
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    return okJson(await listDeleted());
  } catch (e) {
    return internalError(e);
  }
}
