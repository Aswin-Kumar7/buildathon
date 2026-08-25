import { z } from 'zod';

export const auditEntrySchema = z.object({
  seq: z.number().int().positive(),
  at: z.number().int(),
  /** Null when the system did it — expiry and activation name nobody. */
  actor: z.string().nullable(),
  kind: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  payload: z.unknown(),
  policyVersion: z.number().int().nullable(),
  policyHash: z.string().nullable(),
  /** The chain link. Shown so a reader can follow it, and see it is what the next entry records. */
  hash: z.string(),
  prevHash: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListResponseSchema = z.object({
  entries: z.array(auditEntrySchema),
});
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

export const divergenceSchema = z.object({
  seq: z.number().int(),
  reason: z.enum(['hash-mismatch', 'broken-link', 'sequence-gap', 'out-of-order']),
  detail: z.string(),
});

/**
 * The result of walking the chain.
 *
 * `valid` alone is not the useful answer — where and how it broke is. A tamper report that said
 * only "invalid" would send an operator to read every row by hand, which is the work the chain
 * exists to save.
 */
export const auditVerifyResponseSchema = z.object({
  valid: z.boolean(),
  entries: z.number().int().nonnegative(),
  /** The head hash. What an external anchor would pin to make a full rewrite detectable too. */
  head: z.string().nullable(),
  firstDivergence: divergenceSchema.nullable(),
});
export type AuditVerifyResponse = z.infer<typeof auditVerifyResponseSchema>;
