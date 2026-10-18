import { appliesToSeries, compressAudience } from '@/core/calendar/compress';
import { parseHolidaysQuery } from '@/core/validation/holidays-query';
import { getHolidaysInRange, getStructure, toCoreStructure } from '@/server/db/queries';
import { internalError, jsonError } from '@/server/http/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const query = parseHolidaysQuery(new URL(req.url).searchParams);
  if (!query.ok) return jsonError(400, 'BAD_REQUEST', query.message);
  const { from, to, series } = query.value;

  try {
    const [structureRows, rows] = await Promise.all([getStructure(), getHolidaysInRange(from, to)]);
    const structure = toCoreStructure(structureRows);

    const items = rows
      .filter((h) => series === undefined || appliesToSeries(h.audience, structure, series))
      .map((h) => ({
        id: h.id,
        title: h.title,
        note: h.note,
        startDate: h.startDate,
        endDate: h.endDate,
        audience: h.audience,
        label: compressAudience(h.audience, structure),
        updatedBy: h.updatedBy,
        updatedAt: h.updatedAt,
      }));

    return Response.json(
      { holidays: items },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (e) {
    return internalError(e);
  }
}
