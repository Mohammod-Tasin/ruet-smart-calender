import { z } from 'zod';

export const MAX_RANGE_DAYS = 400;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since epoch for a "YYYY-MM-DD" string, or null if it is not a real calendar date. */
function dayNumber(s: string): number | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.getTime() / 86_400_000; // UTC midnight on both sides: no time-zone effects
}

export const isRealDate = (s: string) => dayNumber(s) !== null;

const isoDate = z.string().refine(isRealDate, 'must be a real date, YYYY-MM-DD');

export const holidaysQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    series: z.coerce.number().int().positive().optional(),
  })
  .superRefine((q, ctx) => {
    const from = dayNumber(q.from);
    const to = dayNumber(q.to);
    if (from === null || to === null) return;
    if (from > to)
      ctx.addIssue({ code: 'custom', path: ['from'], message: '"from" must be <= "to"' });
    else if (to - from > MAX_RANGE_DAYS)
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `range must be at most ${MAX_RANGE_DAYS} days`,
      });
  });

export type HolidaysQuery = z.infer<typeof holidaysQuerySchema>;

/** Returns the parsed query, or a human-readable message for a 400 response. */
export function parseHolidaysQuery(
  params: URLSearchParams,
): { ok: true; value: HolidaysQuery } | { ok: false; message: string } {
  const result = holidaysQuerySchema.safeParse({
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    series: params.get('series') ?? undefined,
  });
  if (result.success) return { ok: true, value: result.data };
  const message = result.error.issues
    .map((i) => `${i.path.join('.') || 'query'}: ${i.message}`)
    .join('; ');
  return { ok: false, message };
}
