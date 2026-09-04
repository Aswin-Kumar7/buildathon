import { z } from 'zod';

export const policyWorkflowStatusSchema = z.enum([
  'draft',
  'pending_approval',
  'approved',
  'published',
  'rejected',
]);
export type PolicyWorkflowStatus = z.infer<typeof policyWorkflowStatusSchema>;

export const policyVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  hash: z.string(),
  status: policyWorkflowStatusSchema,
  createdBy: z.string(),
  /** Display name for `createdBy`, resolved from the users table. Null if the user is unknown. */
  createdByName: z.string().nullable().default(null),
  approvedBy: z.string().nullable(),
  /** Display name for `approvedBy`, resolved from the users table. Null when unapproved/unknown. */
  approvedByName: z.string().nullable().default(null),
  createdAt: z.number().int(),
  approvedAt: z.number().int().nullable(),
  publishedAt: z.number().int().nullable(),
  /**
   * The settings this version actually holds, so history can show what restoring it would do.
   * Parsed from the stored source on the server — null if that source no longer parses, which is
   * said plainly rather than guessed at.
   */
  settings: z
    .object({
      stepUp: z.number(),
      contain: z.number(),
      defaultMinutes: z.number().int(),
      maxMinutes: z.number().int(),
      containmentAlwaysNeedsApproval: z.boolean(),
      dualApprovalAbovePaise: z.number().int(),
    })
    .nullable()
    .default(null),
});
export type PolicyVersion = z.infer<typeof policyVersionSchema>;

export const policyVersionListResponseSchema = z.object({ versions: z.array(policyVersionSchema) });
export type PolicyVersionListResponse = z.infer<typeof policyVersionListResponseSchema>;

/** The body of a policy save: the whole document, as YAML source. */
export const policySaveRequestSchema = z.object({ source: z.string().min(1).max(20_000) });
