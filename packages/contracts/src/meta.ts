import { z } from 'zod';

/**
 * Evidence layers, exposed by the API so the landing page reports what is actually
 * proven rather than what is planned. The whole project turns on not overclaiming,
 * so the front door reads its status from the running system.
 */
export const evidenceStatusSchema = z.enum(['not-started', 'in-progress', 'ready']);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

export const evidenceLayerSchema = z.object({
  id: z.enum(['L1', 'L2', 'L3']),
  name: z.string().min(1),
  source: z.string().min(1),
  proves: z.string().min(1),
  status: evidenceStatusSchema,
  arrivesIn: z.string().min(1),
});
export type EvidenceLayer = z.infer<typeof evidenceLayerSchema>;

export const metaSchema = z.object({
  name: z.literal('Sentinel'),
  claim: z.string().min(1),
  version: z.string().min(1),
  commit: z.string().min(1),
  slice: z.object({ number: z.number().int().min(0), name: z.string().min(1) }),
  evidenceLayers: z.array(evidenceLayerSchema).length(3),
});
export type Meta = z.infer<typeof metaSchema>;
