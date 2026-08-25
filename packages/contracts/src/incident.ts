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
