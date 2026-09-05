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

/**
 * The deployed model's headline held-out numbers, exposed on the public endpoint so the landing
 * page reads real metrics rather than hardcoding them. Null when the model artefact is absent (a
 * clone where nobody ran the pipeline), so the page can say so rather than render zeros.
 */
export const metaModelSchema = z.object({
  prAuc: z.number(),
  recall: z.number(),
  falseDeclineRate: z.number(),
});
export type MetaModel = z.infer<typeof metaModelSchema>;

export const metaSchema = z.object({
  name: z.literal('Sentinel'),
  /**
   * Where the merchant storefront is served from, resolved at request time rather than baked into
   * the web bundle. Vite inlines `import.meta.env` at build time, so a deployment that sets the
   * storefront's address on the running container had no way to reach the already-built page — it
   * fell back to a same-origin link and sent people to the API instead. Null when unconfigured,
   * which means the caller keeps its own build-time default.
   */
  storefrontUrl: z.string().url().nullable(),
  claim: z.string().min(1),
  version: z.string().min(1),
  commit: z.string().min(1),
  slice: z.object({ number: z.number().int().min(0), name: z.string().min(1) }),
  evidenceLayers: z.array(evidenceLayerSchema).length(3),
  model: metaModelSchema.nullable(),
});
export type Meta = z.infer<typeof metaSchema>;
