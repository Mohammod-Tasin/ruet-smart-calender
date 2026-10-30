import { z } from 'zod';
import { CATEGORIES, suspendedWeekProblem } from '@/core/calendar/rules';
import type { AudienceEntry } from '@/core/calendar/types';
import { isRealDate } from './holidays-query';

const title = z.string().trim().min(1).max(100);

// "" means "no note"; null clears an existing one (PATCH).
const note = z
  .union([z.null(), z.string().trim().max(500)])
  .transform((v) => (v === '' ? null : v));

const date = z.string().refine(isRealDate, 'must be a real date, YYYY-MM-DD');

const audienceEntry = z
  .object({
    scopeType: z.enum(['ALL', 'FACULTY', 'DEPARTMENT', 'SERIES']),
    scopeId: z.number().int().positive().nullish(),
  })
  .superRefine((e, ctx) => {
    if (e.scopeType === 'ALL' ? e.scopeId != null : e.scopeId == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['scopeId'],
        message: e.scopeType === 'ALL' ? 'ALL takes no scopeId' : 'scopeId is required',
      });
    }
  })
  .transform((e): AudienceEntry => ({ scopeType: e.scopeType, scopeId: e.scopeId ?? null }));

export const audience = z
  .array(audienceEntry)
  .min(1, 'audience must not be empty')
  .max(300)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const [i, e] of list.entries()) {
      const key = `${e.scopeType}:${e.scopeId}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: [i], message: 'duplicate audience entry' });
      }
      seen.add(key);
    }
  });

const confirmOverlap = z.boolean().optional();

const orderCheck = (v: { startDate?: string; endDate?: string }, ctx: z.RefinementCtx) => {
  if (v.startDate !== undefined && v.endDate !== undefined && v.endDate < v.startDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'endDate must be on or after startDate',
    });
  }
};

const category = z.enum(CATEGORIES);

const suspendedCheck = (
  v: { category?: string; startDate?: string; endDate?: string },
  ctx: z.RefinementCtx,
) => {
  if (v.startDate === undefined || v.endDate === undefined) return; // PATCH: checked on the merged value
  const problem = suspendedWeekProblem({ ...v, startDate: v.startDate, endDate: v.endDate });
  if (problem) ctx.addIssue({ code: 'custom', path: ['category'], message: problem });
};

const base = z.object({
  title,
  note: note.optional(),
  category: category.optional(),
  classesOnly: z.boolean().optional(),
  startDate: date,
  endDate: date,
  audience,
  confirmOverlap,
});

export const createHolidaySchema = base.superRefine((v, ctx) => {
  orderCheck(v, ctx);
  suspendedCheck(v, ctx);
});

/** Same body as create, plus an optional id to leave out (used while editing a holiday). */
export const checkOverlapSchema = base
  .extend({ excludeId: z.number().int().positive().optional() })
  .superRefine((v, ctx) => {
    orderCheck(v, ctx);
    suspendedCheck(v, ctx);
  });

export const patchHolidaySchema = z
  .object({
    title: title.optional(),
    note: note.optional(),
    startDate: date.optional(),
    endDate: date.optional(),
    audience: audience.optional(),
    category: category.optional(),
    classesOnly: z.boolean().optional(),
    confirmOverlap,
  })
  .superRefine((v, ctx) => {
    orderCheck(v, ctx);
    const fields = [v.title, v.note, v.startDate, v.endDate, v.audience, v.category, v.classesOnly];
    if (fields.every((x) => x === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'nothing to update' });
    }
  });

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type PatchHolidayInput = z.infer<typeof patchHolidaySchema>;
export type CheckOverlapInput = z.infer<typeof checkOverlapSchema>;

/** Human-readable message for a 400 response. */
export function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}
