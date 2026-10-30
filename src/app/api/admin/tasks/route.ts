import { internalError } from '@/server/http/errors';
import { requireAdmin } from '@/server/http/guard';
import { okJson } from '@/server/http/result';
import { listTasks } from '@/server/services/journey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The admin to-do list: generated from the journeys, never stored.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    return okJson(await listTasks());
  } catch (e) {
    return internalError(e);
  }
}
