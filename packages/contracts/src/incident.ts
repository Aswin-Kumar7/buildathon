import { modelOpinionSchema } from './model.js';
import { z } from 'zod';

export const incidentStatusSchema = z.enum([
  'open',
  'under_review',
  'contained',
  'resolved',
  'expired',
]);
export type IncidentStatusDto = z.infer<typeof incidentStatusSchema>;

export const severitySchema = z.enum(['low', 'medium', 'high']);

/**
 * One thing a rule observed, as a code and two numbers.
 *
 * Never a sentence. The wording a person reads is rendered in the console from these, which
 * means the reason an incident fired can be counted and compared, and cannot drift from what
 * happened because somebody improved the phrasing.
 */
export const evidenceSchema = z.object({
  rule: z.string(),
  code: z.string(),
  observed: z.number(),
  threshold: z.number(),
  /** Signed. Negative is mitigating, and appears in the same list so nothing is hidden. */
  weight: z.number(),
});
export type EvidenceDto = z.infer<typeof evidenceSchema>;

export const abstentionSchema = z.object({
  rule: z.string(),
  reason: z.enum(['insufficient-data', 'unconfirmed-estimate']),
});

export const changeAlarmSchema = z.object({
  fired: z.boolean(),
  at: z.number().int().nullable(),
  statistic: z.number(),
  limit: z.number(),
  buckets: z.number().int().nonnegative(),
});

export const changeResultSchema = z.object({
  baseline: z.object({
    mean: z.number(),
    deviation: z.number(),
    buckets: z.number().int().nonnegative(),
  }),
  ewma: changeAlarmSchema,
  cusum: changeAlarmSchema,
});

export const incidentSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  entityKind: z.enum(['session', 'device', 'network']),
  entityKey: z.string(),

  status: incidentStatusSchema,
  severity: severitySchema,

  score: z.number(),
  scoreLower: z.number(),
  scoreUpper: z.number(),
  band: z.enum(['high', 'medium', 'low']),

  firstAttemptAt: z.number().int(),
  detectedAt: z.number().int(),
  lastActivityAt: z.number().int(),
  expiresAt: z.number().int(),
  /** Milliseconds from the first attempt to the moment the rules could act on it. */
  timeToDetectMs: z.number().int().nonnegative(),

  observations: z.number().int().positive(),
  source: z.enum(['razorpay', 'replay']),
  /** The rules that fired against this entity, mitigating ones excluded. */
  firedRules: z.array(z.string()),
});
export type IncidentSummary = z.infer<typeof incidentSummarySchema>;

export const incidentDetailSchema = incidentSummarySchema.extend({
  evidence: z.array(evidenceSchema),
  abstentions: z.array(abstentionSchema),
  change: changeResultSchema.nullable(),
  /** Null for incidents recorded before arbitration existed. */
  arbitration: z.lazy(() => arbitrationSchema).nullable(),
  /** Model B's advisory opinion, or null when unavailable or not scored this pass. */
  modelOpinion: modelOpinionSchema.nullable(),
  /** False means the model artefact is absent — the decision ran rules-only, degraded:model. */
  modelAvailable: z.boolean(),
  /** Which threshold set judged this. A score means nothing without what it was compared to. */
  thresholdHash: z.string(),
  history: z.array(
    z.object({
      from: incidentStatusSchema,
      to: incidentStatusSchema,
      /** Null when the system did it. Expiry is automatic and says so rather than blaming anyone. */
      actor: z.string().nullable(),
      note: z.string().nullable(),
      at: z.number().int(),
    }),
  ),
});
export type IncidentDetail = z.infer<typeof incidentDetailSchema>;

export const incidentListResponseSchema = z.object({
  incidents: z.array(incidentSummarySchema),
  /** Counted apart, always. A replayed incident is not evidence the system works. */
  counts: z.object({
    open: z.number().int().nonnegative(),
    underReview: z.number().int().nonnegative(),
    contained: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
  }),
  thresholdHash: z.string(),
});
export type IncidentListResponse = z.infer<typeof incidentListResponseSchema>;

export const incidentDetailResponseSchema = z.object({ incident: incidentDetailSchema });
export type IncidentDetailResponse = z.infer<typeof incidentDetailResponseSchema>;

export const transitionRequestSchema = z.object({
  to: incidentStatusSchema,
  note: z.string().max(500).optional(),
});
export type TransitionRequest = z.infer<typeof transitionRequestSchema>;

export const evaluateResponseSchema = z.object({
  evaluated: z.number().int().nonnegative(),
  opened: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
});
export type EvaluateResponse = z.infer<typeof evaluateResponseSchema>;

export const hypothesisSchema = z.enum([
  'attack',
  'outage',
  'retry_storm',
  'healthy_traffic',
  'insufficient_evidence',
]);
export type HypothesisDto = z.infer<typeof hypothesisSchema>;

export const decisionSchema = z.enum(['contain', 'review', 'monitor', 'none']);
export type DecisionDto = z.infer<typeof decisionSchema>;

export const expectationSchema = z.object({
  code: z.string(),
  observed: z.number(),
  expected: z.number(),
  met: z.boolean(),
  weight: z.number(),
});

export const hypothesisFitSchema = z.object({
  hypothesis: hypothesisSchema,
  support: z.number().min(0).max(1),
  probability: z.number().min(0).max(1),
  expectations: z.array(expectationSchema),
});

/**
 * The competing explanations, and which one won.
 *
 * Carried in full rather than reduced to the winner: the runner-up and the margin between them
 * are what tell a reader whether the verdict was a conclusion or a coin toss, and the rejected
 * explanations are what let them see the case that was considered and dismissed.
 */
export const arbitrationSchema = z.object({
  best: hypothesisSchema,
  runnerUp: hypothesisSchema,
  margin: z.number(),
  fits: z.array(hypothesisFitSchema),
  decision: decisionSchema,
  abstained: z.boolean(),
  reasons: z.array(z.string()),
  /** How the model moved the rule-based decision, when it did — the driver flag for a load-bearing model. */
  modelInfluence: z
    .enum(['none', 'corroborated', 'escalated', 'deescalated', 'flagged'])
    .optional(),
});
export type ArbitrationDto = z.infer<typeof arbitrationSchema>;

/** One scenario as the comparison view shows it: same layout, different conclusion. */
export const comparisonCaseSchema = z.object({
  family: z.string(),
  title: z.string(),
  classification: z.string(),
  entityKind: z.enum(['session', 'device', 'network']),
  attempts: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  distinctCards: z.number().int().nonnegative().nullable(),
  approvalRate: z.number(),
  /** The shop around it, which is what makes the three tell apart at all. */
  traffic: z.object({
    attempts: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    approvalRate: z.number(),
    infrastructureFailureShare: z.number(),
    failingSessions: z.number().int().nonnegative(),
    activeSessions: z.number().int().nonnegative(),
    topSessionFailureShare: z.number(),
  }),
  arbitration: arbitrationSchema,
  counterfactual: z.object({
    hypothesis: hypothesisSchema,
    ifWrongToAct: z.string(),
    ifWrongToWait: z.string(),
  }),
});
export type ComparisonCase = z.infer<typeof comparisonCaseSchema>;

export const comparisonResponseSchema = z.object({
  cases: z.array(comparisonCaseSchema),
  thresholdHash: z.string(),
});
export type ComparisonResponse = z.infer<typeof comparisonResponseSchema>;
