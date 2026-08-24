import { z } from 'zod';

export const roleSchema = z.enum(['analyst', 'admin']);
export type Role = z.infer<typeof roleSchema>;

export const loginRequestSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
  role: roleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const loginResponseSchema = z.object({
  user: sessionUserSchema,
  csrfToken: z.string().min(1),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** `null` when nobody is signed in — an unauthenticated caller is not an error. */
export const meResponseSchema = z.object({
  user: sessionUserSchema.nullable(),
  csrfToken: z.string().nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
