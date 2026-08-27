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
  approvedBy: z.string().nullable(),
  createdAt: z.number().int(),
  approvedAt: z.number().int().nullable(),
  publishedAt: z.number().int().nullable(),
});
export type PolicyVersion = z.infer<typeof policyVersionSchema>;

export const policyVersionListResponseSchema = z.object({ versions: z.array(policyVersionSchema) });
export type PolicyVersionListResponse = z.infer<typeof policyVersionListResponseSchema>;

export const policyDraftRequestSchema = z.object({ source: z.string().min(1).max(20_000) });
export const policyIdRequestSchema = z.object({ id: z.string().uuid() });
