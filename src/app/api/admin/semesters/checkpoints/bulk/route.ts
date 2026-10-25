import { bulkCheckpointSchema } from '@/core/validation/semesters';
import { adminMutation } from '@/server/http/mutation';
import { addCheckpoints } from '@/server/services/semesters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// "These semesters are all in <phase> week <n> from <date>".
export async function POST(req: Request) {
  return adminMutation(req, bulkCheckpointSchema, addCheckpoints, 201);
}
