import { z } from 'zod';

/** Read-only facts about this workspace's environment — real config, never hand-typed strings. */
export const workspaceResponseSchema = z.object({
  environment: z.enum(['development', 'test', 'production']),
  /** True only in production. Anything else runs on test payment keys, so no live money moves. */
  liveMode: z.boolean(),
  currency: z.string(),
  /** How long the redacted forensic data is kept, in days. */
  retentionDays: z.number().int().positive(),
  sessionHours: z.number().int().positive(),
  loginMaxAttempts: z.number().int().positive(),
  loginWindowMinutes: z.number().int().positive(),
  ai: z.object({
    /** The advisory Risk Manager is answering live (a provider is configured and its mode is live). */
    enabled: z.boolean(),
    mode: z.string(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
  }),
});
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;

/** Editing your own profile — name and access level. Both optional, so either can change on its own. */
export const updateProfileRequestSchema = z
  .object({
    displayName: z.string().min(1).max(80).optional(),
    role: z.enum(['analyst', 'admin']).optional(),
  })
  .refine((body) => body.displayName !== undefined || body.role !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** The three severities an incident can carry — the notification preference gates on it. */
export const notifySeveritySchema = z.enum(['low', 'medium', 'high']);
export type NotifySeverity = z.infer<typeof notifySeveritySchema>;

/**
 * Per-user preferences for the console's notification bell.
 *
 * A notification here is a real incident surfaced in the console — there is no email or chat
 * delivery in this environment, so nothing is ever "sent" somewhere the backend cannot prove. These
 * only govern which incidents raise the bell, and up to when this user has seen them.
 */
export const notificationPrefsSchema = z.object({
  /** Only incidents at or above this severity notify you. 'low' means every incident. */
  minSeverity: notifySeveritySchema,
  /** Whether simulated (replayed) incidents notify you, or only live ones. */
  simulated: z.boolean(),
  /** When this user last marked notifications read (ISO), or null if never. */
  seenAt: z.string().datetime().nullable(),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

/** A change to your notification preferences — either field alone, so one can move without the other. */
export const updateNotificationPrefsRequestSchema = z
  .object({
    minSeverity: notifySeveritySchema.optional(),
    simulated: z.boolean().optional(),
  })
  .refine((body) => body.minSeverity !== undefined || body.simulated !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateNotificationPrefsRequest = z.infer<typeof updateNotificationPrefsRequestSchema>;
