import { putSettingsSchema } from '@/core/validation/journey';
import { internalError } from '@/server/http/errors';
import { requireAdmin } from '@/server/http/guard';
import { moderatorMutation } from '@/server/http/mutation';
import { okJson } from '@/server/http/result';
import { getSettings, putSettings } from '@/server/services/journey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    return okJson(await getSettings());
  } catch (e) {
    return internalError(e);
  }
}

export async function PUT(req: Request) {
  return moderatorMutation(req, putSettingsSchema, (admin, body) =>
    putSettings(
      admin,
      body.structure,
      body.femaleStudentPercentage,
      body.departmentCounts,
      body.brothersCounts,
    ),
  );
}
