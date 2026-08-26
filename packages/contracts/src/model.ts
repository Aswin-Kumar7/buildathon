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
    /** The analyst review budget the operating point respects — a share of all traffic. */
    reviewCap: z.number(),
    /** Legitimate shoppers wrongly blocked, as a share of all legitimate traffic. */
    falseDeclineRate: z.number(),
    /** Share of traffic blocked at the cost-optimal threshold. */
    blockRate: z.number(),
    /** Share of traffic routed to a human — the riskiest non-blocked traffic, capped at reviewCap. */
    reviewRate: z.number(),
    /** The lower threshold of the review band; below it, traffic is allowed. */
    reviewThreshold: z.number(),
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
 * The model's opinion on an incident: its card-testing risk score and how it read it.
 *
 * The model is load-bearing but leashed. This carries the risk itself — P(abuse) — the band that risk
 * falls in at the served operating point (observe / review / contain-eligible), whether the model is
 * borderline enough to defer to a person, and — for the "why flagged" panel — the per-feature
 * contributions that add up to the score. The deterministic rules and arbitration still decide what
 * is *done*; this informs that decision and can move it only within the bounds the leash allows.
 */
export const modelOpinionSchema = z.object({
  /** P(abuse), in [0, 1] — the served risk score. */
  risk: z.number(),
  /** The coarse call at the served block threshold: 'abuse' or 'benign'. */
  predictedClass: z.string(),
  /** Which served band the risk falls in. */
  band: z.enum(['observe', 'review', 'contain_eligible']),
  /** True in the review band — the model itself would route this to a person rather than decide. */
  abstained: z.boolean(),
  /** The two-class distribution, [benign, abuse], for the calibration bar. */
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
    prAuc: z.number(),
    precision: z.number(),
    recall: z.number(),
  }),
});
export type ModelRegistry = z.infer<typeof modelRegistrySchema>;

export const modelRegistryResponseSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true), registry: modelRegistrySchema }),
  z.object({ available: z.literal(false), reason: z.string() }),
]);
export type ModelRegistryResponse = z.infer<typeof modelRegistryResponseSchema>;

/**
 * The deployed card-testing risk model's honest evaluation — the one served in the request path.
 *
 * This is the number the reader is shown precision/recall/PR-AUC for, and it is *this* model that
 * scores the merchant's traffic. The per-origin breakdown is the heart of it: where the model is
 * right and where it is wrong, so a high aggregate cannot hide a weakness. The labels are synthetic
 * and the schema says so — `provenance.dataNote` carries the disclaimer verbatim.
 */
export const riskModelMetricsSchema = z.object({
  provenance: z.object({
    /** "synthetic-cardtesting" — what the numbers are a claim about. Never real-world labels. */
    dataSource: z.string(),
    modelBackend: z.string(),
    dataNote: z.string(),
    seed: z.number().int(),
    nRows: z.number().int(),
    nGroups: z.number().int(),
    positiveRate: z.number(),
  }),
  honest: z.object({
    model: z.string(),
    reviewCap: z.number(),
    nTest: z.number().int(),
    positives: z.number().int(),
    threshold: z.number(),
    precision: intervalSchema,
    recall: intervalSchema,
    f1: intervalSchema,
    prAuc: intervalSchema,
    rocAuc: z.number(),
    brier: z.number(),
    falseDeclineRate: z.number(),
    blockRate: z.number(),
    reviewRate: z.number(),
    reviewThreshold: z.number(),
    reliability: z.array(z.object({ predicted: z.number(), observed: z.number() })),
    perOrigin: z.array(
      z.object({
        origin: z.string(),
        n: z.number().int(),
        positive: z.boolean(),
        recall: z.number().nullable(),
        falsePositiveRate: z.number().nullable(),
        meanRisk: z.number(),
      }),
    ),
  }),
  /** The no-skill floor: the PR-AUC a ranker with no information reaches (the positive prevalence). */
  baselineNoSkill: z.object({ prAuc: z.number() }),
  leakage: z.object({
    honestPrAuc: z.number(),
    naivePrAuc: z.number(),
    delta: z.number(),
    honestGroupOverlap: z.number().int(),
    naiveGroupOverlap: z.number().int(),
  }),
  cost: z.object({
    falseNegativePaise: z.number().int(),
    falsePositivePaise: z.number().int(),
  }),
  featureImportance: z.array(z.object({ feature: z.string(), importance: z.number() })),
  learningCurve: z.array(
    z.object({ trainFraction: z.number(), nTrain: z.number().int(), valPrAuc: z.number() }),
  ),
  ablation: z.array(
    z.object({ features: z.string(), nFeatures: z.number().int(), prAuc: z.number() }),
  ),
  errorTaxonomy: z.array(
    z.object({
      amountBand: z.string(),
      n: z.number().int(),
      falsePositive: z.number().int(),
      falseNegative: z.number().int(),
    }),
  ),
  registry: modelRegistrySchema,
});
export type RiskModelMetrics = z.infer<typeof riskModelMetricsSchema>;

export const riskModelMetricsResponseSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true), model: riskModelMetricsSchema }),
  z.object({ available: z.literal(false), reason: z.string() }),
]);
export type RiskModelMetricsResponse = z.infer<typeof riskModelMetricsResponseSchema>;
