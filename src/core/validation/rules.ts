import { z } from 'zod';
import { CATEGORIES, type RuleParams } from '@/core/calendar/rules';
import { audience } from './holiday';
import { isRealDate } from './holidays-query';

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const point = z.object({ month: int(1, 12), day: int(1, 30), offsetDays: int(-60, 60) });

const params = z
  .union([
    z.object({
      kind: z.literal('GREGORIAN_FIXED'),
      month: int(1, 12),
      day: int(1, 31),
      lengthDays: int(1, 60),
    }),
    z.object({ kind: z.literal('HIJRI'), startHijri: point, endHijri: point }),
    z.object({
      kind: z.literal('HIJRI'),
      type: z.literal('LAST_WEEKDAY'),
      hijriMonth: int(1, 12),
      weekday: int(0, 6),
    }),
    z.object({ kind: z.literal('MANUAL_YEARLY'), defaultLengthDays: int(1, 60) }),
  ])
  .superRefine((p, ctx) => {
    // 30 Feb / 31 Apr etc. can never happen.
    if (p.kind === 'GREGORIAN_FIXED' && !isRealDate(`2024-${pad(p.month)}-${pad(p.day)}`)) {
      ctx.addIssue({ code: 'custom', message: 'not a real calendar day' });
    }
  }) as z.ZodType<RuleParams>;

const pad = (n: number) => String(n).padStart(2, '0');
const year = int(2000, 2100);
const title = z.string().trim().min(1).max(100);

const ruleFields = {
  title,
  category: z.enum(CATEGORIES),
  classesOnly: z.boolean(),
  audience,
  params,
};

export const createRuleSchema = z.object({ ...ruleFields, effectiveFromYear: year });

/** Edit "from year onward"; every other field is optional. */
export const patchRuleSchema = z
  .object({ fromYear: year })
  .extend(z.object(ruleFields).partial().shape)
  .refine((v) => Object.keys(v).length > 1, 'nothing to update');

export const endRuleSchema = z.object({ fromYear: year });

const date = z.string().refine(isRealDate, 'must be a real date, YYYY-MM-DD');

/** Upsert one year's override. Dates are both set or both omitted. */
export const overrideSchema = z
  .object({
    year,
    startDate: date.nullish(),
    endDate: date.nullish(),
    skipped: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    note: z.string().trim().max(500).nullish(),
  })
  .superRefine((v, ctx) => {
    if (!v.startDate !== !v.endDate || (v.startDate && v.endDate && v.endDate < v.startDate)) {
      ctx.addIssue({ code: 'custom', message: 'give both dates, endDate on or after startDate' });
    }
  });

export const clearOverrideSchema = z.object({ year });

export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type PatchRuleInput = z.infer<typeof patchRuleSchema>;
export type OverrideInput = z.infer<typeof overrideSchema>;
