import { z } from 'zod';

// No minimum password length here: that rule applies when a password is created, and a
// login check must not reveal it. The max stops huge inputs reaching argon2.
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254).includes('@'),
  password: z.string().min(1).max(1024),
});

export type LoginInput = z.infer<typeof loginSchema>;
