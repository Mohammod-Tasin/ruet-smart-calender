import { parseMonthKey, todayInDhaka } from '@/core/calendar/grid';
import { isRealDate } from '@/core/validation/holidays-query';
import { internalError, jsonError } from '@/server/http/errors';
import { holidayReport } from '@/server/services/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Monthly or 3-week holiday & break report (default current month in Asia/Dhaka).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  const from = url.searchParams.get('from');

  const selectedDate = from && isRealDate(from) ? from : undefined;
  const targetMonth =
    month && parseMonthKey(month) ? month : selectedDate ? selectedDate.slice(0, 7) : undefined;

  if (targetMonth) {
    try {
      return Response.json(
        await holidayReport(targetMonth, { mode: 'month', from: selectedDate }),
        {
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
        },
      );
    } catch (e) {
      return internalError(e);
    }
  }

  const target = from ?? todayInDhaka().slice(0, 7);
  if (parseMonthKey(target)) {
    try {
      return Response.json(await holidayReport(target, { mode: 'month' }), {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
      });
    } catch (e) {
      return internalError(e);
    }
  }

  if (!isRealDate(target)) {
    return jsonError(400, 'BAD_REQUEST', 'from must be a real date, YYYY-MM-DD or YYYY-MM.');
  }

  try {
    return Response.json(
      await holidayReport(target.slice(0, 7), { mode: 'month', from: target }),
      {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
      },
    );
  } catch (e) {
    return internalError(e);
  }
}
