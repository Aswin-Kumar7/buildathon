import { z } from 'zod';

export const actionSchema = z.enum(['observe', 'step_up', 'contain', 'escalate', 'release']);
export type ActionDto = z.infer<typeof actionSchema>;

export const containmentStatusSchema = z.enum([
  'proposed',
  'active',
  'rejected',
  'expired',
  'released',
]);
export type ContainmentStatusDto = z.infer<typeof containmentStatusSchema>;

/**
 * The two halves of getting it wrong, never averaged.
 *
 * A single expected-cost number would hide which way the asymmetry runs, and the asymmetry is
 * the only thing about it worth knowing.
 */
export const expectedCostSchema = z.object({
  ifWeAct: z.number().int().nonnegative(),
  ifWeWait: z.number().int().nonnegative(),
  currency: z.literal('INR'),
});

export const policyDecisionSchema = z.object({
  action: actionSchema,
  /** Codes, never prose. The console renders the sentences. */
  reasons: z.array(z.string()),
  /** Rules that forbade something stronger. Empty when nothing was held back. */
  refusals: z.array(z.string()),
  approvalsRequired: z.number().int().nonnegative(),
  expiresAfterMinutes: z.number().int().positive().nullable(),
  expectedCost: expectedCostSchema,
  policyVersion: z.number().int().positive(),
  policyHash: z.string(),
});
export type PolicyDecisionDto = z.infer<typeof policyDecisionSchema>;

export const containmentEventSchema = z.object({
  kind: z.string(),
  /** Null when the system did it. Expiry names nobody rather than blaming somebody. */
  actor: z.string().nullable(),
  note: z.string().nullable(),
  at: z.number().int(),
});

export const containmentSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  entityKind: z.enum(['session', 'device', 'network']),
  entityKey: z.string(),

  action: actionSchema,
  status: containmentStatusSchema,

  approvalsRequired: z.number().int().nonnegative(),
  /** Distinct people who have agreed so far. Never includes the same person twice. */
  approvals: z.array(z.string()),

  decision: policyDecisionSchema,
  policyVersion: z.number().int().positive(),
  policyHash: z.string(),

  proposedBy: z.string().nullable(),
  proposedAt: z.number().int(),
  activatedAt: z.number().int().nullable(),
  expiresAt: z.number().int().nullable(),
  endedAt: z.number().int().nullable(),
  extensions: z.number().int().nonnegative(),

  history: z.array(containmentEventSchema),
});
export type ContainmentDto = z.infer<typeof containmentSchema>;

export const containmentListResponseSchema = z.object({
  containments: z.array(containmentSchema),
});
export type ContainmentListResponse = z.infer<typeof containmentListResponseSchema>;

export const containmentResponseSchema = z.object({ containment: containmentSchema });
export type ContainmentResponse = z.infer<typeof containmentResponseSchema>;

export const proposeRequestSchema = z.object({ note: z.string().max(500).optional() });

export const approvalRequestSchema = z.object({
  note: z.string().max(500).optional(),
  /** Extending only. Minutes to add, bounded by the policy's ceiling. */
  minutes: z.number().int().positive().optional(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

/** The policy as loaded, for the console to show and the simulator to run against. */
export const policyResponseSchema = z.object({
  version: z.number().int().positive(),
  hash: z.string(),
  killSwitch: z.boolean(),
  thresholds: z.object({ stepUp: z.number(), contain: z.number() }),
  containment: z.object({
    defaultMinutes: z.number().int().positive(),
    maxMinutes: z.number().int().positive(),
    maxExtensions: z.number().int().nonnegative(),
  }),
  approval: z.object({
    dualApprovalAbovePaise: z.number().int().nonnegative(),
    containmentAlwaysNeedsApproval: z.boolean(),
  }),
  impactCaps: z.object({
    maxActiveContainments: z.number().int().nonnegative(),
    maxContainmentsPerHour: z.number().int().nonnegative(),
    maxShareOfActiveSessions: z.number(),
    shareAppliesAboveSessions: z.number().int().nonnegative(),
  }),
  degradation: z.object({
    maxFeatureAgeMinutes: z.number().int().nonnegative(),
    requireConfirmedCounts: z.boolean(),
    refuseWhenArbitrationAbstained: z.boolean(),
  }),
  /** Order-of-magnitude estimates, labelled as such wherever they appear. */
  costs: z.object({
    chargebackPaise: z.number().int().nonnegative(),
    blockedShopperPaise: z.number().int().nonnegative(),
    reviewPaise: z.number().int().nonnegative(),
  }),
  allowlisted: z.object({
    sessions: z.number().int().nonnegative(),
    devices: z.number().int().nonnegative(),
    networks: z.number().int().nonnegative(),
  }),
});
export type PolicyResponse = z.infer<typeof policyResponseSchema>;

/**
 * What a policy would have decided on incidents that already happened.
 *
 * The question an analyst actually asks before changing a threshold — "what would this have
 * done?" — answered against real recorded incidents rather than against intuition.
 */
export const simulationRowSchema = z.object({
  incidentId: z.string(),
  entityKind: z.enum(['session', 'device', 'network']),
  entityKey: z.string(),
  detectedAt: z.number().int(),
  current: policyDecisionSchema,
  proposed: policyDecisionSchema,
  changed: z.boolean(),
});
export type SimulationRow = z.infer<typeof simulationRowSchema>;

export const simulationResponseSchema = z.object({
  rows: z.array(simulationRowSchema),
  summary: z.object({
    considered: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    /** How many would newly be contained, which is the number worth being nervous about. */
    newlyContained: z.number().int().nonnegative(),
    newlyReleased: z.number().int().nonnegative(),
  }),
  /** Present when the submitted policy could not be used at all. */
  problems: z.array(z.string()),
});
export type SimulationResponse = z.infer<typeof simulationResponseSchema>;

export const simulateRequestSchema = z.object({
  /** A whole policy document. Simulated, never saved — this endpoint changes nothing. */
  policy: z.string().max(20_000),
  limit: z.number().int().positive().max(200).optional(),
});
