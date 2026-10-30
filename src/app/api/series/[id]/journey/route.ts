import { statusQuerySchema } from '@/core/validation/semesters';
import { internalError, jsonError } from '@/server/http/errors';
import { failure, parseId } from '@/server/http/result';
import { seriesJourney } from '@/server/services/journey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// One series: state on a date, all semesters with start dates, every week.
export async function GET(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return jsonError(400, 'BAD_REQUEST', 'Invalid id.');
  const q = statusQuerySchema.safeParse({
    date: new URL(req.url).searchParams.get('date') ?? undefined,
  });
  if (!q.success) return jsonError(400, 'BAD_REQUEST', 'date must be a real date, YYYY-MM-DD.');
  try {
    const result = await seriesJourney(id, q.data.date);
    if (!result.ok) return failure(result);
    return Response.json(result.value, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (e) {
    return internalError(e);
  }
}
