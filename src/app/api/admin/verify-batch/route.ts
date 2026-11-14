import { verifyBatchSchema } from '@/core/validation/journey';
import { adminMutation } from '@/server/http/mutation';
import { verifyBatch } from '@/server/services/journey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mark a batch column (intakeYear) as verified right now.
export async function POST(req: Request) {
  return adminMutation(req, verifyBatchSchema, (adminId, body) =>
    verifyBatch(adminId, body.intakeYear),
  );
}

