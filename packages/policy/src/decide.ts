/**
 * From an explanation to a proposal.
 *
 * The detector says what the traffic is. This says what may be done about it, and it is a
 * strictly higher bar: being confident that something is card testing is not the same as being
 * entitled to stop somebody paying. Every refusal along the way is recorded as a code, because
 * "we chose not to act, and here is which rule stopped us" is the output an analyst actually
 * needs — an empty result tells them nothing.
 *
 * Nothing here acts. It proposes, and the proposal carries what approval it would need. The
 * separation is the point: a function that both decided and executed would be one where the
 * decision could not be reviewed before it took effect.
 */

import type { Arbitration, FeatureVector, TrafficContext } from '@sentinel/detect';
import { ACTIONS, isCustomerImpacting, type Action } from './actions.js';
import { policyHash, type Policy } from './policy.js';

/** What the system knows about itself when the decision is made. */
export interface SystemState {
  /** The moment being decided at. Explicit, never a clock read, so a decision can be replayed. */
  now: number;
  /** When the features were last recomputed. Staleness is a reason not to act. */
  featuresAsOf: number;
  activeContainments: number;
  containmentsInLastHour: number;
}

export interface ExpectedCost {
  /** Cost if we act and the traffic turns out to be legitimate. */
  ifWeAct: number;
  /** Cost if we wait and it turns out to be an attack. */
  ifWeWait: number;
  /**
   * The two are not symmetric and are never averaged into one number. Presenting a single
   * "expected cost" would hide which way the asymmetry runs, which is the only thing about it
   * worth knowing.
   */
  currency: 'INR';
}

export interface PolicyDecision {
  action: Action;
  /** Codes, never prose. The console renders the sentences, as everywhere else. */
  reasons: string[];
  /** Rules that forbade something stronger. Empty when nothing was held back. */
  refusals: string[];

  /** How many distinct people must agree before this takes effect. Zero means it may proceed. */
  approvalsRequired: number;
  /** Null for actions that do not expire. Everything the shopper notices has one. */
  expiresAfterMinutes: number | null;

  expectedCost: ExpectedCost;
  policyVersion: number;
  policyHash: string;
}

/**
 * Expected cost of each direction, from the hypothesis probabilities and the declared costs.
 *
 * Deliberately simple arithmetic over numbers that live in `policy.yaml`: the probability that
 * this is *not* an attack, times what a wrongly blocked shopper costs, against the probability
 * that it *is*, times what letting it run costs. The value of showing it is not precision — the
 * cost figures are order-of-magnitude estimates and say so — it is that the asymmetry becomes
 * visible, and the asymmetry is real.
 */
function expectedCost(
  arbitration: Arbitration,
  vector: FeatureVector,
  policy: Policy,
): ExpectedCost {
  const attack = arbitration.fits.find((fit) => fit.hypothesis === 'attack')?.probability ?? 0;
  const legitimate = 1 - attack;

  // What is still to come is estimated from what has already happened, which is the only
  // evidence available. Rounded to whole rupees because false precision here would be a lie.
  const remainingAttempts = Math.max(vector.attempts, 1);

  return {
    ifWeAct: Math.round(legitimate * policy.costs.blockedShopperPaise),
    ifWeWait: Math.round(attack * policy.costs.chargebackPaise * Math.min(remainingAttempts, 10)),
    currency: 'INR',
  };
}

/** Whether this entity is one the merchant has said never to act against. */
function allowlisted(vector: FeatureVector, policy: Policy): boolean {
  const list =
    vector.entityKind === 'session'
      ? policy.allowlist.sessions
      : vector.entityKind === 'device'
        ? policy.allowlist.devices
        : policy.allowlist.networks;

  return list.includes(vector.entityKey);
}

/**
 * The degradation matrix.
 *
 * One rule, stated once: **if we cannot see clearly, we do not touch a customer.** Stale
 * features, counts that were never confirmed, and an arbitration that declined to decide are
 * each sufficient on their own. Each returns a code rather than a boolean so the console can say
 * which one applied — a refusal nobody can explain is indistinguishable from a bug.
 */
export function degradationRefusals(
  arbitration: Arbitration,
  vector: FeatureVector,
  state: SystemState,
  policy: Policy,
): string[] {
  const refusals: string[] = [];

  const ageMinutes = Math.max(state.now - state.featuresAsOf, 0) / 60_000;
  if (ageMinutes > policy.degradation.maxFeatureAgeMinutes) {
    refusals.push('feature_state_is_stale');
  }

  if (policy.degradation.requireConfirmedCounts && vector.distinctCards.exact === null) {
    refusals.push('counts_never_confirmed');
  }

  if (policy.degradation.refuseWhenArbitrationAbstained && arbitration.abstained) {
    refusals.push('arbitration_abstained');
  }

  return refusals;
}

/** Ceilings that hold however confident anything is. */
function capRefusals(state: SystemState, traffic: TrafficContext, policy: Policy): string[] {
  const refusals: string[] = [];

  if (state.activeContainments >= policy.impactCaps.maxActiveContainments) {
    refusals.push('too_many_active_containments');
  }
  if (state.containmentsInLastHour >= policy.impactCaps.maxContainmentsPerHour) {
    refusals.push('hourly_containment_cap_reached');
  }

  // A share only means something once there are enough sessions to take a share of. A shop with
  // three customers would otherwise never be allowed to contain anybody, because one of three is
  // a third of everything — the same reason the hypotheses refuse to read a shape into six
  // attempts. Below the floor the absolute caps above are what hold, and they still do.
  if (traffic.activeSessions >= policy.impactCaps.shareAppliesAboveSessions) {
    const share = (state.activeContainments + 1) / traffic.activeSessions;
    if (share > policy.impactCaps.maxShareOfActiveSessions) {
      // A detector convinced that a large share of the shop is an attack is far more likely to
      // be wrong than right, and this is what stops a confident mistake becoming a large one.
      refusals.push('would_contain_too_much_of_the_shop');
    }
  }

  return refusals;
}

export interface DecideInput {
  arbitration: Arbitration;
  vector: FeatureVector;
  traffic: TrafficContext;
  state: SystemState;
  policy: Policy;
}

type Base = Pick<PolicyDecision, 'expectedCost' | 'policyVersion' | 'policyHash'>;

/** A decision that does nothing, for the cases where the answer is a refusal. */
const inert = (base: Base, reason: string, refusal = reason): PolicyDecision => ({
  ...base,
  action: 'observe',
  reasons: [reason],
  refusals: [refusal],
  approvalsRequired: 0,
  expiresAfterMinutes: null,
});

/**
 * The refusals that decide the whole answer on their own, in the order they are checked.
 *
 * Order is not incidental. The kill switch comes first and is unconditional — it is the control
 * that has to work when every assumption behind the others has failed, and a check that ran
 * after something else could be reached by breaking that something else.
 */
function shortCircuit(
  arbitration: Arbitration,
  vector: FeatureVector,
  policy: Policy,
  base: Base,
): PolicyDecision | null {
  if (policy.killSwitch) return inert(base, 'kill_switch_engaged');
  if (allowlisted(vector, policy)) return inert(base, 'entity_is_allowlisted');

  // A better explanation than an attack is a reason not to act, and says so rather than simply
  // failing to reach a threshold.
  if (arbitration.best !== 'attack') {
    return {
      ...base,
      action: arbitration.decision === 'review' ? 'escalate' : 'observe',
      reasons: [`better_explanation_${arbitration.best}`],
      refusals: [`suppressed_by_${arbitration.best}`],
      approvalsRequired: 0,
      expiresAfterMinutes: null,
    };
  }

  return null;
}

export function decide({
  arbitration,
  vector,
  traffic,
  state,
  policy,
}: DecideInput): PolicyDecision {
  const cost = expectedCost(arbitration, vector, policy);
  const base: Base = {
    expectedCost: cost,
    policyVersion: policy.version,
    policyHash: policyHash(policy),
  };

  const refused = shortCircuit(arbitration, vector, policy, base);
  if (refused !== null) return refused;

  const support = arbitration.fits.find((fit) => fit.hypothesis === 'attack')?.support ?? 0;

  const blocked = [
    ...degradationRefusals(arbitration, vector, state, policy),
    ...capRefusals(state, traffic, policy),
  ];

  const wanted: Action =
    support >= policy.thresholds.contain
      ? 'contain'
      : support >= policy.thresholds.stepUp
        ? 'step_up'
        : 'escalate';

  // Anything the shopper would notice is off the table while the system cannot see clearly.
  // Escalating is still allowed — telling a person is not something done *to* anybody.
  if (blocked.length > 0 && isCustomerImpacting(wanted)) {
    return {
      ...base,
      action: 'escalate',
      reasons: ['degraded_or_capped_so_escalated_instead'],
      refusals: blocked,
      approvalsRequired: 0,
      expiresAfterMinutes: null,
    };
  }

  const shape = ACTIONS[wanted];
  const needsApproval =
    wanted === 'contain' && policy.approval.containmentAlwaysNeedsApproval
      ? cost.ifWeAct > policy.approval.dualApprovalAbovePaise
        ? 2
        : 1
      : 0;

  return {
    ...base,
    action: wanted,
    reasons: [
      `attack_supported_at_${support.toFixed(2)}`,
      ...(needsApproval === 2 ? ['impact_above_dual_approval_threshold'] : []),
    ],
    refusals: blocked,
    approvalsRequired: needsApproval,
    expiresAfterMinutes: shape.expires ? policy.containment.defaultMinutes : null,
  };
}
