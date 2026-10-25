import { z } from 'zod';
import { audience } from './holiday';
import { isRealDate } from './holidays-query';
import { PHASES } from '../semester/timeline';

const date = z.string().refine(isRealDate, 'must be a real date, YYYY-MM-DD');
const phase = z.enum(PHASES);
const note = z.string().trim().max(500).nullish();
const label = z.string().trim().max(30).nullish();
const ids = z.array(z.number().int().positive()).min(1).max(100);

export const templateSchema = z
  .array(
    z.object({
      phase,
      weeks: z.number().int().min(1).max(30),
      extendable: z.boolean(),
    }),
  )
  .min(1)
  .max(10);

export const bulkStartSchema = z.object({
  seriesIds: ids,
  startDate: date,
  label,
  template: templateSchema.optional(),
});

export const patchSemesterSchema = z
  .object({ label, startDate: date.optional(), template: templateSchema.optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nothing to update');

export const bulkCheckpointSchema = z.object({
  semesterIds: ids,
  asOfDate: date,
  phase,
  weekIndex: z.number().int().min(1).max(30),
  note,
});

export const weekOverrideSchema = z.object({
  weekStart: date,
  mode: z.enum(['FORCE_EXTEND', 'NO_EXTEND']),
  note,
});
export const clearWeekOverrideSchema = z.object({ weekStart: date });

/** A pin on CLASS would only repeat the start date, so it is not allowed. */
export const pinSchema = z.object({
  phase: z.enum(['MID_BREAK', 'VIVA', 'FINALS']),
  startDate: date,
  note,
});
export const clearPinSchema = z.object({ phase: z.enum(['MID_BREAK', 'VIVA', 'FINALS']) });

const removeId = z.union([
  z.number().int().positive(),
  z.string().regex(/^rule:\d+:\d{4}$/, 'a holiday id or "rule:<id>:<year>"'),
]);
export const impactSchema = z
  .object({
    removeIds: z.array(removeId).max(50).optional(),
    add: z
      .array(
        z.object({
          startDate: date,
          endDate: date,
          audience,
          title: z.string().max(100).optional(),
        }),
      )
      .max(20)
      .optional(),
  })
  .refine((v) => (v.removeIds?.length ?? 0) + (v.add?.length ?? 0) > 0, 'describe a change');

export const statusQuerySchema = z.object({ date: date.optional() });

export type BulkStartInput = z.infer<typeof bulkStartSchema>;
export type PatchSemesterInput = z.infer<typeof patchSemesterSchema>;
export type BulkCheckpointInput = z.infer<typeof bulkCheckpointSchema>;
export type WeekOverrideInput = z.infer<typeof weekOverrideSchema>;
export type PinInput = z.infer<typeof pinSchema>;
