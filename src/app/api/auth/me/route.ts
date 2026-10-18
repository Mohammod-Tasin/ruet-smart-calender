import { internalError } from '@/server/http/errors';
import { requireAdmin } from '@/server/http/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;
    return Response.json({ admin: auth.admin }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return internalError(e);
  }
}
