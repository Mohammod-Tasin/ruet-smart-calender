import { internalError, jsonError } from '@/server/http/errors';
import { academicBreaksInRange } from '@/server/services/journey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!from || !to || !DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
    return jsonError(400, 'BAD_REQUEST', 'from and to must be valid YYYY-MM-DD dates');
  }

  try {
    const breaks = await academicBreaksInRange(from, to);
    return Response.json(
      { breaks },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (e) {
    return internalError(e);
  }
}

