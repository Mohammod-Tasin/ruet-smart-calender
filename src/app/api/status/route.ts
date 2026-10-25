import { statusQuerySchema } from '@/core/validation/semesters';
import { internalError, jsonError } from '@/server/http/errors';
import { statusOn } from '@/server/services/semesters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// State of every series' semester on a date (default today, Asia/Dhaka).
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
