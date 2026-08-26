/**
 * Every number a rule is allowed to compare against, in one place.
 *
 * Declared here rather than inlined at the comparison for the same reason the scenario specs
 * are committed before the detector exists: a threshold buried in an `if` is a threshold
 * nobody reviews, and one quietly nudged until the corpus looks good is tuning disguised as
 * engineering. `thresholdHash()` makes a change to any of them show up as a changed hash in a
 * diff, so moving one is a decision somebody made rather than something that drifted.
 *
 * The values come from the corpus's own separation — the point at which the attack families
 * sit on one side and the operational ones on the other — and every one of them is a reason to
 * look, never a verdict. What is *done* about a score is Slice 10's problem, deliberately.
 */

import { minutes } from './decay.js';

export interface Thresholds {
  /** Attempts per minute, decayed. Above this, something is trying hard. */
  velocityPerMinute: number;
  /** Distinct confirmed cards before card spread counts as spread at all. */
  cardSpreadMinimum: number;
  /** Cards per attempt. Enumeration walks a list; dunning retries the same few. */
  cardsPerAttempt: number;
  /** Attempts per card at which the traffic is retrying rather than enumerating. */
  attemptsPerCard: number;
  /** Below this share of captures, with enough attempts, approval has collapsed. */
  approvalFloor: number;
  /** Attempts needed before an approval rate means anything at all. */
  approvalMinimumAttempts: number;
  /** Herfindahl concentration at which one decline reason dominates. */
  reasonConcentration: number;
  /** Share of attempts at or below a trivial amount. */
  smallAmountShare: number;
  /** Coefficient of variation below which arrivals look like a timer rather than people. */
  machineCadence: number;
  /** Attempts needed before cadence is measurable rather than noise. */
  cadenceMinimumAttempts: number;
  /** Share of failures blamed on the gateway before an outage is the better explanation. */
  infrastructureShare: number;
  /** How long an incident stays open with nothing new before it expires. */
  incidentIdleMs: number;
  /** The score below which nothing is put in front of a person at all. */
  incidentFloor: number;
  /** Score at which an incident is severe. Severity orders a queue; it does not decide action. */
  severityHigh: number;
  severityMedium: number;

  /**
   * How far ahead the best explanation must be before it is treated as the explanation.
   *
   * Below this the traffic is genuinely ambiguous, and the honest response to ambiguity is a
   * person rather than an automatic action against a shopper.
   */
  arbitrationMargin: number;
  /** How well the attack hypothesis must fit its own expectations before containment. */
  containmentSupport: number;
  /**
   * The model's risk, P(abuse), at or above which it is treated as calling an attack — high enough to
   * escalate a rule-suppressed case to a person, or to corroborate a containment. Deliberately far
   * above the model's *own* cost-optimal block threshold: the model scores aggressively for its own
   * recall, but overriding the deterministic rules is a stronger act and needs more confidence. Below
   * it (and above the benign bar) the model is a passenger and the rules decide alone.
   */
  modelHighRisk: number;
  /**
   * The risk at or below which the model is treated as calling it benign — low enough to de-escalate
   * a rule-driven containment it disputes down to a review. Real attacks score far above this, so it
   * never softens a genuine one; it is the safety valve for a containment the model is sure is wrong.
   */
  modelLowRisk: number;
  /**
   * The higher bar for the model to raise a case entirely on its own — an entity no single-entity
   * rule opened anything for, which is the distributed and low-and-slow attack a burst gate cannot
   * see. It only ever routes to review, never containment.
   */
  modelFlagRisk: number;
}

export const THRESHOLDS: Thresholds = {
  velocityPerMinute: 1.5,
  cardSpreadMinimum: 8,
  cardsPerAttempt: 0.7,
  attemptsPerCard: 2,
  approvalFloor: 0.2,
  approvalMinimumAttempts: 6,
  reasonConcentration: 0.45,
  smallAmountShare: 0.6,
  machineCadence: 0.35,
  cadenceMinimumAttempts: 6,
  infrastructureShare: 0.5,
  incidentIdleMs: minutes(30),
  incidentFloor: 0.4,
  severityHigh: 0.7,
  severityMedium: 0.5,
  arbitrationMargin: 0.08,
  containmentSupport: 0.7,
  modelHighRisk: 0.7,
  modelLowRisk: 0.15,
  modelFlagRisk: 0.8,
};

/**
 * A stable fingerprint of the thresholds, so a change to any of them is visible.
 *
 * Sorted by key, because an object's insertion order is not a fact about its contents and a
 * hash that changed when a field moved would be noise. Same construction as the corpus's
 * `specHash` — this is the detector half of the same pre-registration idea.
 */
export function thresholdHash(thresholds: Thresholds = THRESHOLDS): string {
  const canonical = Object.keys(thresholds)
    .sort()
    .map((key) => `${key}=${thresholds[key as keyof Thresholds]}`)
    .join(';');

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
