import { internalError } from '@/server/http/errors';
import { getStructure } from '@/server/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const s = await getStructure();
    return Response.json(
      {
        faculties: s.faculties,
        departments: s.departments,
        series: s.series.map(({ id, departmentId, intakeYear }) => ({
          id,
          departmentId,
          intakeYear,
        })),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (e) {
    return internalError(e);
  }
}
