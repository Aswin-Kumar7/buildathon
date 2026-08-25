import { z } from 'zod';

/** A point estimate with the 95% bootstrap interval around it. A number without its spread is half
 * a claim, so the model page never shows one without the other. */
export const intervalSchema = z.object({
  point: z.number(),
  low: z.number(),
  high: z.number(),
});

export const modelMetricsSchema = z.object({
  provenance: z.object({
    /** "ieee-cis" or "synthetic" — which decides what the numbers are a claim about. */
    dataSource: z.string(),
    modelBackend: z.string(),
    dataNote: z.string(),
    seed: z.number().int(),
    nRows: z.number().int(),
    nUids: z.number().int(),
    fraudRate: z.number(),
  }),
  honest: z.object({
    model: z.string(),
    threshold: z.number(),
    nTest: z.number().int(),
    positives: z.number().int(),
    precision: intervalSchema,
    recall: intervalSchema,
    prAuc: intervalSchema,
    rocAuc: z.number(),
    brier: z.number(),
    reliability: z.array(z.object({ predicted: z.number(), observed: z.number() })),
  }),
  baselineLogisticPrAuc: z.number(),
  /** The published leakage delta: the careless split's score beside the honest one. */
  leakage: z.object({
    honestPrAuc: z.number(),
    naivePrAuc: z.number(),
    delta: z.number(),
    honestUidOverlap: z.number().int(),
    naiveUidOverlap: z.number().int(),
    droppedToGap: z.number().int(),
  }),
  cost: z.object({
    falseNegativePaise: z.number().int(),
    falsePositivePaise: z.number().int(),
  }),
  featureImportance: z.array(z.object({ feature: z.string(), importance: z.number() })),
  learningCurve: z.array(
    z.object({ trainFraction: z.number(), nTrain: z.number().int(), valPrAuc: z.number() }),
  ),
  errorTaxonomy: z.array(
    z.object({
      amountBand: z.string(),
      n: z.number().int(),
      falsePositive: z.number().int(),
      falseNegative: z.number().int(),
    }),
  ),
});
export type ModelMetrics = z.infer<typeof modelMetricsSchema>;

/**
 * The metrics, or an honest "not generated yet".
 *
 * The artefact is produced by a Python pipeline the JS server does not run. If it is absent — a
 * clone where nobody ran `make eval` — the page says so plainly rather than rendering zeros that
 * look like a model with no skill.
 */
export const modelMetricsResponseSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true), metrics: modelMetricsSchema }),
  z.object({ available: z.literal(false), reason: z.string() }),
]);
export type ModelMetricsResponse = z.infer<typeof modelMetricsResponseSchema>;
