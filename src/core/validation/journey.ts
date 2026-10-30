import { z } from 'zod';
import {
  buildSlots,
  J_PHASES,
  slotIndex,
  SEMESTERS,
  type JourneyStructure,
} from '../journey/journey';
import { audience } from './holiday';
import { isRealDate } from './holidays-query';

const date = z.string().refine(isRealDate, 'must be a real date, YYYY-MM-DD');
const note = z.string().trim().max(500).nullish();

export const structureSchema = z
  .array(
    z.object({
      phase: z.enum(J_PHASES),
      weeks: z.number().int().min(1).max(30),
      extendable: z.boolean(),
    }),
  )
  .min(1)
  .max(12)
  .refine((s) => s.some((b) => b.phase === 'CLASS'), 'needs at least one CLASS block')
  .refine((s) => s.some((b) => b.phase === 'EXAM'), 'needs at least one EXAM block');

export const putSettingsSchema = z.object({ structure: structureSchema });

/** Same position for many series at once (a whole intake, or a few). */
export const bulkPositionsSchema = z
  .object({
    seriesIds: z.array(z.number().int().positive()).min(1).max(200),
    kind: z.enum(['POSITION', 'SEMESTER_START']),
    asOfDate: date,
    semesterNo: z.number().int().min(1).max(SEMESTERS),
    // SEMESTER_START is always CLASS week 1; the client may leave these out.
    phase: z.enum(J_PHASES).optional(),
    weekNo: z.number().int().min(1).max(30).optional(),
    note,
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'POSITION' && (v.phase === undefined || v.weekNo === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'POSITION needs phase and weekNo' });
    }
    if (new Set(v.seriesIds).size !== v.seriesIds.length) {
      ctx.addIssue({ code: 'custom', path: ['seriesIds'], message: 'duplicate series' });
    }
  });
export type BulkPositionsInput = z.infer<typeof bulkPositionsSchema>;

/** null when the structure has this week, else the reason. */
export function positionProblem(
  structure: JourneyStructure,
  phase: (typeof J_PHASES)[number],
  weekNo: number,
): string | null {
  return slotIndex(buildSlots(structure), phase, weekNo) >= 0
    ? null
    : `${phase} week ${weekNo} does not exist in the semester structure.`;
}

const removeId = z.union([
  z.number().int().positive(),
  z.string().regex(/^rule:\d+:\d{4}$/, 'a holiday id or "rule:<id>:<year>"'),
]);
/** A proposed holiday change, for the impact preview. */
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
