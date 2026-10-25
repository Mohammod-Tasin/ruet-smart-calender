import { parseHolidaysQuery } from '@/core/validation/holidays-query';
import { internalError, jsonError } from '@/server/http/errors';
import { getOffDays } from '@/server/services/off-days';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const query = parseHolidaysQuery(new URL(req.url).searchParams);
  if (!query.ok) return jsonError(400, 'BAD_REQUEST', query.message);
  const { from, to, series } = query.value;

  try {
    const items = await getOffDays({ from, to }, { seriesId: series });
    // Public: show who set it, not their account id.
    const holidays = items.map((h) => ({ ...h, updatedBy: { name: h.updatedBy.name } }));
    return Response.json(
      { holidays },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (e) {
    return internalError(e);
  }
}
