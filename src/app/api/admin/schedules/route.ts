import { scheduleSchema } from '@/core/validation/journey';
import { adminMutation } from '@/server/http/mutation';
import { setSchedule } from '@/server/services/journey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A different schedule for one semester of some series, or "yes, the default is right".
export async function POST(req: Request) {
  return adminMutation(req, scheduleSchema, setSchedule);
}
