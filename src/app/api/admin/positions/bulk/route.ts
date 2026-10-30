import { bulkPositionsSchema } from '@/core/validation/journey';
import { adminMutation } from '@/server/http/mutation';
import { bulkPositions } from '@/server/services/journey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POSITION or SEMESTER_START for many series at once (one transaction).
export async function POST(req: Request) {
  return adminMutation(req, bulkPositionsSchema, bulkPositions, 201);
}
