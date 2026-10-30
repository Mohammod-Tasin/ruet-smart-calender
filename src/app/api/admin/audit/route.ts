import { internalError, jsonError } from '@/server/http/errors';
import { requireAdmin } from '@/server/http/guard';
import { okJson, parseId } from '@/server/http/result';
import { listAudit } from '@/server/services/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ?holidayId=N for one holiday's history; without it, the latest 100 changes overall.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const raw = new URL(req.url).searchParams.get('holidayId');
  const holidayId = raw === null ? undefined : parseId(raw);
  if (holidayId === null)
    return jsonError(400, 'BAD_REQUEST', 'holidayId must be a positive integer.');

  try {
    return okJson({ entries: await listAudit({ holidayId }) });
  } catch (e) {
    return internalError(e);
  }
}
