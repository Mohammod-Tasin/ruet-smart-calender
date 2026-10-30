import { statusQuerySchema } from '@/core/validation/semesters';
import { internalError, jsonError } from '@/server/http/errors';
import { statusOn } from '@/server/services/journey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Matrix data: every active series' journey state on a date (default today, Asia/Dhaka).
// Lives at /api/status/journey while the Phase 10 /api/status stays; 12b moves it to /api/status.
export async function GET(req: Request) {
  const q = statusQuerySchema.safeParse({
    date: new URL(req.url).searchParams.get('date') ?? undefined,
  });
  if (!q.success) return jsonError(400, 'BAD_REQUEST', 'date must be a real date, YYYY-MM-DD.');
  try {
    return Response.json(await statusOn(q.data.date), {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (e) {
    return internalError(e);
  }
}
