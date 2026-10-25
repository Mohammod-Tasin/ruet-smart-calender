import { bulkStartSchema } from '@/core/validation/semesters';
import { adminMutation } from '@/server/http/mutation';
import { bulkStart } from '@/server/services/semesters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Start a semester for many series at once (default template, one start date).
export async function POST(req: Request) {
  return adminMutation(req, bulkStartSchema, bulkStart, 201);
}
