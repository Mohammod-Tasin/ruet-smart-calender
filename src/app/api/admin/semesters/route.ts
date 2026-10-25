import { internalError, jsonError } from '@/server/http/errors';
import { requireAdmin } from '@/server/http/guard';
import { okJson, parseId } from '@/server/http/result';
import { listSemesters } from '@/server/services/semesters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Semesters with their checkpoints, week overrides and pins. ?seriesId= narrows to one series.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const raw = new URL(req.url).searchParams.get('seriesId');
  const seriesId = raw === null ? undefined : parseId(raw);
  if (seriesId === null) return jsonError(400, 'BAD_REQUEST', 'Invalid seriesId.');
  try {
    return okJson(await listSemesters(seriesId));
  } catch (e) {
    return internalError(e);
  }
}
