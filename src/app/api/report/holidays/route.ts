import { todayInDhaka } from '@/core/calendar/grid';
import { isRealDate } from '@/core/validation/holidays-query';
import { internalError, jsonError } from '@/server/http/errors';
import { holidayReport } from '@/server/services/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 3-week holiday & break report from `from` (default today, Asia/Dhaka).
export async function GET(req: Request) {
  const from = new URL(req.url).searchParams.get('from') ?? todayInDhaka();
  if (!isRealDate(from))
    return jsonError(400, 'BAD_REQUEST', 'from must be a real date, YYYY-MM-DD.');
  try {
    return Response.json(await holidayReport(from), {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (e) {
    return internalError(e);
  }
}
