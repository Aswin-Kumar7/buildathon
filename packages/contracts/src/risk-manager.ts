import { z } from 'zod';
import { actionSchema, policyDecisionSchema } from './containment.js';
import { incidentStatusSchema } from './incident.js';

/**
 * The AI Risk Manager — an advisory reasoning layer over an incident's verified record.
 *
 * It never becomes an authority. The policy engine `decide()` still says what is permitted; the
 * incident-level ML model still produces the risk opinion. This layer reads both (plus the rules'
 * evidence and the policy preview), and recommends one of three backend-supported moves with a
 * grounded rationale. It emits claim *ids* only — the values behind every sentence are bound in
 * code from the verified facts — so it cannot state a number, an identity, or a fact that did not
 * come from the record.
 */

/** The three recommendations, mirroring incident.recommendedDecision (arbitration's `none` → monitor). */
export const riskActionSchema = z.enum(['contain', 'review', 'monitor']);
export type RiskAction = z.infer<typeof riskActionSchema>;

/** Which reasoning tier produced the selection — the same degradation ladder narration uses. */
export const riskSourceSchema = z.enum(['live', 'local', 'replay', 'template']);
export type RiskSource = z.infer<typeof riskSourceSchema>;

/** One grounded line: a claim id resolved to bound text and the evidence keys it was bound from. */
export const riskClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  evidence: z.array(z.string()),
});
export type RiskClaim = z.infer<typeof riskClaimSchema>;

export const riskRecommendationSchema = z.object({
  incidentId: z.string(),
  action: riskActionSchema,
  /** The action label the merchant sees, bound in code — never authored by the model. */
  actionLabel: z.string(),
  /**
   * One summary line for the recommendation: the model's own sentence when it grounded every number
   * it used (see `rationaleAuthored`), otherwise a line bound from the verified facts.
   */
  rationale: z.string(),
  /** True when `rationale` is the model's own (prose-guard-checked) sentence, false when the bound line. */
  rationaleAuthored: z.boolean(),
  /** Ordered grounded reasons — each a claim id, its resolved text, and its evidence keys. */
  keyReasons: z.array(riskClaimSchema),
  /** What additional evidence could change the recommendation, from a fixed catalog. */
  whatWouldChange: z.array(riskClaimSchema),
  /** Whether the recommendation is consistent with the policy preview and the model's influence. */
  alignment: z.enum(['aligned', 'diverges']),
  /** A bound one-liner explaining the alignment — never model-authored. */
  alignmentNote: z.string(),
  /** Policy refusal codes surfaced when a stronger action was held back. Empty when none. */
  refusals: z.array(z.string()),
  /** The action the policy engine would currently support — shown for transparency, not executed. */
  policyAction: actionSchema,
  /** True when the incident-level ML model produced an opinion on the last pass. */
  modelAvailable: z.boolean(),
  /** True when the live provider was unavailable and a deterministic tier answered. */
  degraded: z.boolean(),
  /** True when the incident is replayed/simulated traffic — an executed action would block nobody. */
  rehearsal: z.boolean(),
  source: riskSourceSchema,
  /** The reasoning layer version — recorded in the audit provenance. */
  reasoningVersion: z.string(),
  /** Stable hash of the verified facts this recommendation was grounded on. */
  groundingHash: z.string(),
  /** The claim ids the reasoning tier selected — carried into the audit for provenance. */
  rationaleClaimIds: z.array(z.string()),
  whatWouldChangeIds: z.array(z.string()),
  /** How many selected ids the fact guard dropped: the hallucination signal for this recommendation. */
  dropped: z.number().int().nonnegative(),
});
export type RiskRecommendation = z.infer<typeof riskRecommendationSchema>;

export const riskRecommendationResponseSchema = z.object({
  recommendation: riskRecommendationSchema.nullable(),
});
export type RiskRecommendationResponse = z.infer<typeof riskRecommendationResponseSchema>;

/** The read-only policy decision for an incident, computed without persisting anything. */
export const policyPreviewResponseSchema = z.object({ decision: policyDecisionSchema.nullable() });
export type PolicyPreviewResponse = z.infer<typeof policyPreviewResponseSchema>;

export const riskAcceptRequestSchema = z.object({
  /** The hash of the recommendation the merchant is confirming — a stale snapshot is refused. */
  groundingHash: z.string(),
  note: z.string().max(500).optional(),
});
export type RiskAcceptRequest = z.infer<typeof riskAcceptRequestSchema>;

export const riskRejectRequestSchema = z.object({ note: z.string().max(500).optional() });
export type RiskRejectRequest = z.infer<typeof riskRejectRequestSchema>;

/** What the accept endpoint actually did — never claimed before the backend confirmed it. */
export const riskAcceptOutcomeSchema = z.enum([
  'containment_proposed',
  'moved_to_review',
  'monitoring_recorded',
  'downgraded_to_review',
]);
export type RiskAcceptOutcome = z.infer<typeof riskAcceptOutcomeSchema>;

export const riskAcceptResponseSchema = z.object({
  action: riskActionSchema,
  outcome: riskAcceptOutcomeSchema,
  /** Refusal codes when a contain was downgraded to review by policy. */
  refusals: z.array(z.string()),
  /** The incident status after the action, when it changed. */
  status: incidentStatusSchema.nullable(),
});
export type RiskAcceptResponse = z.infer<typeof riskAcceptResponseSchema>;
