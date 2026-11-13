import { z } from 'zod';
import { ADMIN_ROLES } from '@/core/auth/roles';

export const roleSchema = z.enum(ADMIN_ROLES);

export const createAdminSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100),
  email: z.string().trim().email('Valid email is required.').max(200),
  password: z.string().min(10, 'Password must be at least 10 characters.').max(200),
  role: roleSchema.default('ADMIN'),
});

export const updateAdminSchema = z
  .object({
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(10, 'Password must be at least 10 characters.').max(200).optional(),
  })
  .refine(
    (v) => v.role !== undefined || v.isActive !== undefined || v.password !== undefined,
    'Specify a change.',
  );

export type CreateAdminInput = z.infer<typeof createAdminSchema>;
export type UpdateAdminInput = z.infer<typeof updateAdminSchema>;

