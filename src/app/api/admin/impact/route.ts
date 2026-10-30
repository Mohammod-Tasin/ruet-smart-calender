import { impactSchema } from '@/core/validation/journey';
import { adminMutation } from '@/server/http/mutation';
import { ok } from '@/server/services/shared';
import { computeImpact } from '@/server/services/journey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// What a proposed holiday change would do to semester timelines. Saves nothing.
export async function POST(req: Request) {
  return adminMutation(req, impactSchema, async (_admin, body) => ok(await computeImpact(body)));
}
