import { undoSchema } from '@/core/validation/rules';
import { adminMutation } from '@/server/http/mutation';
import { undoRuleEdit } from '@/server/services/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Undo toast: put a "Change date" back exactly as it was (409 if it was changed again since).
export async function POST(req: Request) {
  return adminMutation(req, undoSchema, (admin, body) => undoRuleEdit(admin, body.undoId));
}
