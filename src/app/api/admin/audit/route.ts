import { internalError, jsonError } from '@/server/http/errors';
import { requireAdmin } from '@/server/http/guard';
import { okJson, parseId } from '@/server/http/result';
import { listAudit } from '@/server/services/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ?holidayId=N for one holiday's history, ?semesterId=N for one semester's; without either,
// the latest 100 changes overall.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const params = new URL(req.url).searchParams;
  const id = (name: string) => {
    const raw = params.get(name);
    return raw === null ? undefined : parseId(raw);
  };
  const holidayId = id('holidayId');
  const semesterId = id('semesterId');
  if (holidayId === null || semesterId === null)
    return jsonError(400, 'BAD_REQUEST', 'holidayId / semesterId must be positive integers.');

  try {
    return okJson({ entries: await listAudit({ holidayId, semesterId }) });
  } catch (e) {
    return internalError(e);
  }
}
