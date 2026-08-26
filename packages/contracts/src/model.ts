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

/** One feature's signed push toward the predicted class — exact SHAP for a linear model. */
export const contributionSchema = z.object({
  feature: z.string(),
  contribution: z.number(),
});

/**
 * The model's advisory opinion on an incident.
 *
 * Advisory is the operative word: the deterministic rules and arbitration decide what is done, and
 * this sits beside that decision to inform it, never to override it. It carries the predicted class,
 * how confident it is, whether it abstained, and — for the "why flagged" panel — the per-feature
 * contributions that add up to the score.
 */
export const modelOpinionSchema = z.object({
  predictedClass: z.string(),
  confidence: z.number(),
  abstained: z.boolean(),
  probabilities: z.array(z.object({ label: z.string(), probability: z.number() })),
  contributions: z.array(contributionSchema),
  modelVersion: z.string(),
});
export type ModelOpinion = z.infer<typeof modelOpinionSchema>;

export const modelRegistrySchema = z.object({
  version: z.string(),
  trainingDataHash: z.string(),
  featureDefinitionVersion: z.string(),
  onnxExported: z.boolean(),
  metricsSnapshot: z.object({
    accuracy: z.number(),
    macroF1: z.number(),
    abstainRate: z.number(),
  }),
});
export type ModelRegistry = z.infer<typeof modelRegistrySchema>;

export const modelRegistryResponseSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true), registry: modelRegistrySchema }),
  z.object({ available: z.literal(false), reason: z.string() }),
]);
export type ModelRegistryResponse = z.infer<typeof modelRegistryResponseSchema>;

/**
 * Model B's benchmark artefact: the four-class classifier's honest evaluation.
 *
 * Carries the three things the slice is done when it shows — the ablation ladder, the risk-coverage
 * curve, and the four-class confusion matrix — plus the corpus-hardening outcome, because a
 * flattering score that was never hardened is not one to trust.
 */
export const incidentModelSchema = z.object({
  classes: z.array(z.string()),
  accuracy: z.number(),
  macroF1: z.number(),
  abstainRate: z.number(),
  abstainThreshold: z.number(),
  perClass: z.array(
    z.object({
      label: z.string(),
      precision: z.number(),
      recall: z.number(),
      support: z.number().int(),
    }),
  ),
  confusion: z.array(z.array(z.number().int())),
  riskCoverage: z.array(
    z.object({ threshold: z.number(), coverage: z.number(), selectiveAccuracy: z.number() }),
  ),
  ablation: z.array(
    z.object({ features: z.string(), nFeatures: z.number().int(), macroF1: z.number() }),
  ),
  hardening: z.object({
    triggered: z.boolean(),
    baseMacroF1: z.number(),
    hardenedMacroF1: z.number().nullable(),
    note: z.string().nullable(),
  }),
  splitGroupOverlap: z.number().int(),
  registry: modelRegistrySchema,
});
export type IncidentModel = z.infer<typeof incidentModelSchema>;

export const incidentModelResponseSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true), model: incidentModelSchema }),
  z.object({ available: z.literal(false), reason: z.string() }),
]);
export type IncidentModelResponse = z.infer<typeof incidentModelResponseSchema>;
