/**
 * Tier 1: deterministic rules over a feature vector.
 *
 * This tier has to be able to run the product on its own. Everything above it — change
 * detection, and later a model — earns its place against these, and when anything above fails
 * these are what is left. So they are pure, cheap, and explainable to somebody who has never
 * read the code.
 *
 * Two commitments that shape the whole file:
 *
 * **No free text.** A rule emits codes and numbers. The sentence a human reads is rendered
 * from those at the edge, which means the reason an incident fired can be compared, counted
 * and tested, and cannot drift from what actually happened because somebody improved the
 * wording.
 *
 * **Mitigating evidence is a first-class outcome, not an absence of evidence.** A rule that
 * can only ever accuse is a rule that will accuse a shopper whose card was declined twice
 * before it worked. Mitigations carry negative weight, appear in the same list, and are shown
 * in the console beside the incriminating ones.
 */

import type { FeatureVector } from './features.js';
import { THRESHOLDS, type Thresholds } from './thresholds.js';

export type RuleId =
  | 'velocity'
  | 'card_spread'
  | 'approval_collapse'
  | 'reason_mix'
  | 'small_amount_probing'
  | 'machine_cadence'
  | 'recovery'
  | 'infrastructure_attribution'
  | 'card_reuse';

/**
 * One observation a rule made, with the number it saw and the number it compared against.
 *
 * `weight` is signed: positive incriminates, negative mitigates. Keeping them in one list
 * rather than two is deliberate — a score is the sum of this list, so nothing can contribute
 * to a decision without appearing in the explanation of it.
 */
export interface Evidence {
  rule: RuleId;
  code: string;
  observed: number;
  threshold: number;
  weight: number;
}

export interface RuleOutcome {
  rule: RuleId;
  fired: boolean;
  evidence: Evidence[];
  /**
   * Set when the rule could not run at all, rather than ran and did not fire.
   *
   * The two are not the same and must never collapse into one. "Not enough attempts to judge
   * cadence" is silence; "cadence looks human" is a finding. A console that showed both as a
   * rule that did not fire would be inviting the reader to treat missing information as
   * evidence of innocence.
   */
  abstained?: 'insufficient-data' | 'unconfirmed-estimate';
}

const fire = (
  rule: RuleId,
  code: string,
  observed: number,
  threshold: number,
  weight: number,
): RuleOutcome => ({ rule, fired: true, evidence: [{ rule, code, observed, threshold, weight }] });

const quiet = (rule: RuleId): RuleOutcome => ({ rule, fired: false, evidence: [] });

export type Abstention = NonNullable<RuleOutcome['abstained']>;

const abstain = (rule: RuleId, why: Abstention): RuleOutcome => ({
  rule,
  fired: false,
  evidence: [],
  abstained: why,
});

/** Something is trying hard. On its own this is a busy shop; it needs company to mean anything. */
function velocity(v: FeatureVector, t: Thresholds): RuleOutcome {
  return v.attemptRate > t.velocityPerMinute
    ? fire('velocity', 'attempt_rate_above_threshold', v.attemptRate, t.velocityPerMinute, 0.2)
    : quiet('velocity');
}

/**
 * Many distinct cards from one entity — the enumeration signature.
 *
 * Reads `exact`, never `estimate`. A sketch is how this entity became worth looking at; it is
 * not something anyone may be accused on. If the confirmation pass has not run, the rule
 * abstains and says which kind of silence it is.
 */
function cardSpread(v: FeatureVector, t: Thresholds): RuleOutcome {
  const cards = v.distinctCards.exact;
  if (cards === null) return abstain('card_spread', 'unconfirmed-estimate');
  if (v.attempts === 0) return abstain('card_spread', 'insufficient-data');

  const perAttempt = cards / v.attempts;
  if (cards < t.cardSpreadMinimum || perAttempt < t.cardsPerAttempt) return quiet('card_spread');

  return {
    rule: 'card_spread',
    fired: true,
    evidence: [
      {
        rule: 'card_spread',
        code: 'distinct_cards_above_threshold',
        observed: cards,
        threshold: t.cardSpreadMinimum,
        weight: 0.35,
      },
      {
        rule: 'card_spread',
        code: 'cards_per_attempt_above_threshold',
        observed: perAttempt,
        threshold: t.cardsPerAttempt,
        weight: 0.15,
      },
    ],
  };
}

/** Almost nothing is being approved. Meaningless on two attempts, which is why there is a floor. */
function approvalCollapse(v: FeatureVector, t: Thresholds): RuleOutcome {
  if (v.attempts < t.approvalMinimumAttempts)
    return abstain('approval_collapse', 'insufficient-data');

  return v.approvalRate < t.approvalFloor
    ? fire('approval_collapse', 'approval_rate_below_floor', v.approvalRate, t.approvalFloor, 0.25)
    : quiet('approval_collapse');
}

/**
 * One decline reason dominating, and it is the card being refused rather than the gateway.
 *
 * The second half matters more than the first. An outage also produces a single dominant
 * reason — that is what an outage *is* — so concentration alone would fire on the one case
 * this system must not act on.
 */
function reasonMix(v: FeatureVector, t: Thresholds): RuleOutcome {
  if (v.failures === 0) return abstain('reason_mix', 'insufficient-data');
  if (v.infrastructureFailureShare >= t.infrastructureShare) return quiet('reason_mix');

  return v.reasonConcentration > t.reasonConcentration
    ? fire(
        'reason_mix',
        'decline_reasons_concentrated',
        v.reasonConcentration,
        t.reasonConcentration,
        0.2,
      )
    : quiet('reason_mix');
}

/** Trivial amounts: the cheapest way to find out whether a card is alive. */
function smallAmountProbing(v: FeatureVector, t: Thresholds): RuleOutcome {
  if (v.attempts === 0) return abstain('small_amount_probing', 'insufficient-data');

  return v.smallAmountShare > t.smallAmountShare
    ? fire(
        'small_amount_probing',
        'small_amount_share_above_threshold',
        v.smallAmountShare,
        t.smallAmountShare,
        0.15,
      )
    : quiet('small_amount_probing');
}

/**
 * Arrivals too evenly spaced to be people.
 *
 * Weak on its own and deliberately weighted as such: a subscription biller's retry schedule is
 * also a timer. It separates *machine* from *human*, not attack from legitimate, and it is
 * only worth anything next to the rules that do.
 */
function machineCadence(v: FeatureVector, t: Thresholds): RuleOutcome {
  if (v.attempts < t.cadenceMinimumAttempts) return abstain('machine_cadence', 'insufficient-data');

  return v.burstiness < t.machineCadence
    ? fire('machine_cadence', 'inter_arrival_variation_low', v.burstiness, t.machineCadence, 0.1)
    : quiet('machine_cadence');
}

/**
 * Orders that failed and were then paid.
 *
 * The single most important rule in this file. A shopper whose card was declined and who then
 * paid is the exact shape of an attack that got lucky, and the only thing that separates them
 * is that money arrived. Weighted heavily enough to pull a vector out of the range where
 * anything would be done about it.
 */
function recovery(v: FeatureVector): RuleOutcome {
  return v.recoveredOrders > 0
    ? fire('recovery', 'orders_recovered_after_failure', v.recoveredOrders, 0, -0.4)
    : quiet('recovery');
}

/** Razorpay blamed its own gateway. Containing anyone here punishes customers for an outage. */
function infrastructureAttribution(v: FeatureVector, t: Thresholds): RuleOutcome {
  if (v.failures === 0) return abstain('infrastructure_attribution', 'insufficient-data');

  return v.infrastructureFailureShare >= t.infrastructureShare
    ? fire(
        'infrastructure_attribution',
        'failures_attributed_to_gateway',
        v.infrastructureFailureShare,
        t.infrastructureShare,
        -0.5,
      )
    : quiet('infrastructure_attribution');
}

/**
 * The same few cards, tried repeatedly — dunning, not enumeration.
 *
 * The mirror of `card_spread`, and the reason both exist. A retry storm and an attack produce
 * a similar number of failures; the difference is entirely in how the cards are distributed
 * across them, so the shape that is *not* an attack has to argue for itself rather than merely
 * fail to trigger the shape that is.
 *
 * Expressed as attempts *per card* rather than cards per attempt, which is the same arithmetic
 * and a different question. The ratio form was set at 0.3 and therefore silent on four cards
 * across eight attempts — a retry run seen through a thirty-minute window, which is how a
 * biller actually appears when only part of its schedule is in view. It let the dunning storm
 * open an incident. "Each card was tried twice" is the thing being claimed, so it is what the
 * rule now measures.
 */
function cardReuse(v: FeatureVector, t: Thresholds): RuleOutcome {
  const cards = v.distinctCards.exact;
  if (cards === null) return abstain('card_reuse', 'unconfirmed-estimate');
  if (v.attempts < t.approvalMinimumAttempts || cards === 0) {
    return abstain('card_reuse', 'insufficient-data');
  }

  const perCard = v.attempts / cards;
  return perCard >= t.attemptsPerCard
    ? fire('card_reuse', 'cards_reused_across_attempts', perCard, t.attemptsPerCard, -0.25)
    : quiet('card_reuse');
}

/** Every rule, in a fixed order so the evidence list is stable across runs. */
export function evaluateRules(
  vector: FeatureVector,
  thresholds: Thresholds = THRESHOLDS,
): RuleOutcome[] {
  return [
    velocity(vector, thresholds),
    cardSpread(vector, thresholds),
    approvalCollapse(vector, thresholds),
    reasonMix(vector, thresholds),
    smallAmountProbing(vector, thresholds),
    machineCadence(vector, thresholds),
    recovery(vector),
    infrastructureAttribution(vector, thresholds),
    cardReuse(vector, thresholds),
  ];
}
