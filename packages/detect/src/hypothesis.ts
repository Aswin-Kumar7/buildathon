/**
 * Competing explanations, judged against each other.
 *
 * Slice 8 produced one score with mitigations subtracted from it. That is workable and it is
 * the wrong shape, because it answers "how bad is this" when the question an analyst actually
 * has is "what *is* this". A subtraction cannot distinguish a case with no evidence of an
 * attack from one with strong evidence of an outage; both come out low, and only one of them
 * means "do nothing, and here is why".
 *
 * So each explanation argues for itself. Every hypothesis declares what it would expect the
 * traffic to look like, is scored on how much of that it actually sees, and the arbitration
 * picks the best-supported one — reporting the runner-up and the margin between them, because
 * a narrow win is not a conclusion.
 *
 * Three commitments:
 *
 * **Abstention is an outcome, not a failure.** When no explanation clearly wins, the honest
 * answer is that we do not know, and the case goes to a person rather than to an action.
 *
 * **Suppression is explicit.** An outage or a retry storm winning does not merely fail to
 * trigger containment — it argues actively against it, and the console shows that argument.
 *
 * **Nothing here requires `payment.downtime.*`.** Razorpay publishes downtime events, and where
 * they exist they corroborate the outage hypothesis. They are never necessary: the outage case
 * is carried by `error_source` and by how far failure has spread, both of which are present on
 * every ordinary webhook.
 */

import type { FeatureVector } from './features.js';
import type { Evidence } from './rules.js';
import type { TrafficContext } from './traffic.js';
import { THRESHOLDS, type Thresholds } from './thresholds.js';

export type Hypothesis =
  'attack' | 'outage' | 'retry_storm' | 'healthy_traffic' | 'insufficient_evidence';

/**
 * What to do about it.
 *
 * `contain` is the only one that touches a shopper, and the only one arbitration will refuse to
 * reach on a narrow margin. `review` puts it in front of a person; `monitor` keeps it visible
 * without implying anybody must act; `none` is for traffic that has explained itself.
 */
export type Decision = 'contain' | 'review' | 'monitor' | 'none';

/** One thing a hypothesis expected, and whether the traffic obliged. */
export interface Expectation {
  code: string;
  observed: number;
  expected: number;
  met: boolean;
  weight: number;
}

export interface HypothesisFit {
  hypothesis: Hypothesis;
  /** Share of this hypothesis's own expectations that were met, in [0, 1]. */
  support: number;
  /** `support` normalised across the competing set, so the five sum to 1. */
  probability: number;
  expectations: Expectation[];
}

export interface Arbitration {
  best: Hypothesis;
  runnerUp: Hypothesis;
  /** Gap in probability between the two. A narrow gap is a reason to ask somebody. */
  margin: number;
  fits: HypothesisFit[];

  decision: Decision;
  /** True when no explanation won clearly enough to act on. Routed to review, never to action. */
  abstained: boolean;
  /** Why the decision is what it is, as codes. The console renders the sentences. */
  reasons: string[];
}

const expect = (
  code: string,
  observed: number,
  expected: number,
  met: boolean,
  weight = 1,
): Expectation => ({ code, observed, expected, met, weight });

/**
 * Whether this entity has done enough for its shape to mean anything.
 *
 * Both of the single-entity hypotheses are about *proportions* — cards per attempt, attempts
 * per card — and a proportion over one attempt carries no information while looking exactly
 * like a strong signal. One failed payment on a cheap card scored as an attack, because "a new
 * card every attempt" and "this session is all of the failures" are both trivially true when
 * there has been one attempt. A hypothesis about shape needs enough traffic to have a shape.
 */
const hasShape = (v: FeatureVector, t: Thresholds): boolean =>
  v.attempts >= t.approvalMinimumAttempts;

/**
 * One machine working through a list of cards.
 *
 * The expectations that matter are about *shape*, not volume: many cards relative to attempts,
 * almost nothing approved, and — the part a per-entity view cannot supply — the failure being
 * concentrated here rather than everywhere, or if it is everywhere, not being the gateway's
 * fault and not coming with a healthy approval rate.
 */
function attack(v: FeatureVector, c: TrafficContext, t: Thresholds): Expectation[] {
  const cards = v.distinctCards.exact ?? 0;
  const perAttempt = v.attempts === 0 ? 0 : cards / v.attempts;
  const concentrated = c.topSessionFailureShare >= 0.5;
  const shaped = hasShape(v, t);

  return [
    expect('enough_attempts_to_have_a_shape', v.attempts, t.approvalMinimumAttempts, shaped, 3),
    expect('many_distinct_cards', cards, t.cardSpreadMinimum, cards >= t.cardSpreadMinimum, 2),
    expect(
      'card_per_attempt_high',
      perAttempt,
      t.cardsPerAttempt,
      shaped && perAttempt >= t.cardsPerAttempt,
      2,
    ),
    expect(
      'approval_collapsed',
      v.approvalRate,
      t.approvalFloor,
      v.attempts >= t.approvalMinimumAttempts && v.approvalRate < t.approvalFloor,
    ),
    expect(
      'failure_not_the_gateways',
      c.infrastructureFailureShare,
      t.infrastructureShare,
      c.infrastructureFailureShare < t.infrastructureShare,
      2,
    ),
    // Either the trouble is concentrated here, or it is spread but the shop is not otherwise
    // healthy — which is what a distributed attack looks like and a flash sale does not.
    expect(
      'not_ordinary_busy_traffic',
      c.approvalRate,
      0.5,
      shaped && (concentrated || c.approvalRate < 0.5),
      2,
    ),
    expect(
      'small_amounts',
      v.smallAmountShare,
      t.smallAmountShare,
      v.smallAmountShare > t.smallAmountShare,
    ),
    // Deliberately not gated on this entity having a shape, because it is a fact about the shop
    // rather than about the entity. It is the only expectation that can speak for an attacker
    // who has spread thin enough that no single session looks like anything: the shop is mostly
    // failing, nobody has blamed the gateway, and almost nothing is being approved. An outage
    // fails the middle clause and a busy afternoon fails the last.
    expect(
      'shop_failing_with_nobody_to_blame',
      c.attempts === 0 ? 0 : c.failures / c.attempts,
      0.5,
      c.attempts > 0 &&
        c.failures / c.attempts >= 0.5 &&
        c.infrastructureFailureShare < t.infrastructureShare &&
        c.approvalRate < 0.3,
      3,
    ),
  ];
}

/**
 * The acquirer, or Razorpay's gateway, having a bad time.
 *
 * Carried entirely by ordinary webhook fields. `payment.downtime.*` would corroborate this and
 * is deliberately not required — a merchant integration that only works when the platform is
 * kind enough to announce its own outage is not much of a detector.
 */
function outage(v: FeatureVector, c: TrafficContext, t: Thresholds): Expectation[] {
  const spread = c.failingSessions >= 5 && c.topSessionFailureShare < 0.5;

  // Definitional, not merely indicative. Razorpay naming its own gateway is what makes this an
  // outage rather than a lot of cards being refused, and without it the rest of the case is
  // just "many people failed" — which is equally true of an attack spread across many sessions.
  // The distributed attack was being explained as an outage on exactly that reasoning, with the
  // gateway never blamed once.
  const blamed = c.infrastructureFailureShare >= t.infrastructureShare;

  return [
    expect('gateway_blamed', c.infrastructureFailureShare, t.infrastructureShare, blamed, 3),
    expect('failure_is_widespread', c.failingSessions, 5, blamed && spread, 2),
    expect(
      'this_entity_blamed_the_gateway_too',
      v.infrastructureFailureShare,
      t.infrastructureShare,
      blamed && v.infrastructureFailureShare >= t.infrastructureShare,
      2,
    ),
    // An outage hits whoever happens to be paying, so nobody is working a card list.
    expect(
      'no_card_walking',
      v.distinctCards.exact ?? 0,
      t.cardSpreadMinimum,
      blamed && (v.distinctCards.exact ?? 0) < t.cardSpreadMinimum,
    ),
  ];
}

/** A biller working through renewals: the same few cards, again and again, on a schedule. */
function retryStorm(v: FeatureVector, c: TrafficContext, t: Thresholds): Expectation[] {
  const cards = v.distinctCards.exact ?? 0;
  const perCard = cards === 0 ? 0 : v.attempts / cards;
  const shaped = hasShape(v, t);

  return [
    expect('enough_attempts_to_have_a_shape', v.attempts, t.approvalMinimumAttempts, shaped, 3),
    expect(
      'cards_reused',
      perCard,
      t.attemptsPerCard,
      shaped && cards > 0 && perCard >= t.attemptsPerCard,
      3,
    ),
    expect(
      'few_distinct_cards',
      cards,
      t.cardSpreadMinimum,
      shaped && cards > 0 && cards < t.cardSpreadMinimum,
      2,
    ),
    expect(
      'not_the_gateways_fault',
      c.infrastructureFailureShare,
      t.infrastructureShare,
      c.infrastructureFailureShare < t.infrastructureShare,
    ),
    // A schedule, not a person. Weak alone — an attack is also a machine — but it separates a
    // biller from a shopper, which is what this hypothesis needs it for.
    expect('runs_on_a_timer', v.burstiness, t.machineCadence, v.burstiness < t.machineCadence),
    expect('some_of_it_works', v.approvalRate, 0.05, v.approvalRate > 0.05),
  ];
}

/**
 * A lot of people buying, and it working. Busy is not the same as wrong.
 *
 * Named for the traffic rather than for the event, because it wins on ordinary healthy traffic
 * too and calling that a flash sale on the page an analyst reads would be wrong. A flash sale is
 * the extreme case this covers, not the only one.
 */
function healthyTraffic(v: FeatureVector, c: TrafficContext, t: Thresholds): Expectation[] {
  const succeeding = c.approvalRate >= 0.8;

  return [
    expect('most_payments_succeed', c.approvalRate, 0.8, succeeding, 3),
    // Conditional on the first, deliberately. Counting shoppers while most of them are failing
    // is not evidence of health — it is what a distributed attack looks like, and it was
    // carrying this hypothesis to a win over one.
    expect('many_shoppers', c.activeSessions, 20, succeeding && c.activeSessions >= 20, 2),
    expect(
      'failure_is_thin_on_the_ground',
      c.failures / Math.max(c.attempts, 1),
      0.2,
      c.failures / Math.max(c.attempts, 1) < 0.2,
      2,
    ),
    expect(
      'nobody_is_walking_a_card_list',
      v.distinctCards.exact ?? 0,
      t.cardSpreadMinimum,
      (v.distinctCards.exact ?? 0) < t.cardSpreadMinimum,
    ),
  ];
}

/**
 * The null hypothesis, and a real one.
 *
 * Scored rather than assumed, so "we do not have enough to say" competes on the same terms as
 * every other explanation instead of being what is left when the others fail. It wins when
 * there is barely any activity, or when a sketch was never confirmed — because a count nobody
 * confirmed is not something to act on.
 */
function insufficient(v: FeatureVector, c: TrafficContext, t: Thresholds): Expectation[] {
  return [
    expect(
      'barely_any_activity',
      v.attempts,
      t.approvalMinimumAttempts,
      v.attempts < t.approvalMinimumAttempts,
      3,
    ),
    expect(
      'counts_never_confirmed',
      v.distinctCards.exact === null ? 1 : 0,
      1,
      v.distinctCards.exact === null,
      3,
    ),
    expect('little_to_compare_against', c.attempts, 10, c.attempts < 10, 2),
  ];
}

const HYPOTHESES: {
  name: Hypothesis;
  of: (v: FeatureVector, c: TrafficContext, t: Thresholds) => Expectation[];
}[] = [
  { name: 'attack', of: attack },
  { name: 'outage', of: outage },
  { name: 'retry_storm', of: retryStorm },
  { name: 'healthy_traffic', of: healthyTraffic },
  { name: 'insufficient_evidence', of: insufficient },
];

/** Explanations that argue *against* containment when they win. */
const SUPPRESSING: readonly Hypothesis[] = ['outage', 'retry_storm', 'healthy_traffic'];

const round = (value: number): number => Math.round(value * 1000) / 1000;

export function arbitrate(
  vector: FeatureVector,
  context: TrafficContext,
  thresholds: Thresholds = THRESHOLDS,
): Arbitration {
  const scored = HYPOTHESES.map(({ name, of }) => {
    const expectations = of(vector, context, thresholds);
    const total = expectations.reduce((sum, e) => sum + e.weight, 0);
    const met = expectations.reduce((sum, e) => sum + (e.met ? e.weight : 0), 0);

    return { hypothesis: name, support: total === 0 ? 0 : met / total, expectations };
  });

  const sum = scored.reduce((total, fit) => total + fit.support, 0);
  const fits: HypothesisFit[] = scored
    .map((fit) => ({
      ...fit,
      support: round(fit.support),
      probability: round(sum === 0 ? 1 / scored.length : fit.support / sum),
    }))
    .sort((a, b) => b.probability - a.probability);

  const best = fits[0]!;
  const runnerUp = fits[1]!;
  const margin = round(best.probability - runnerUp.probability);

  return {
    best: best.hypothesis,
    runnerUp: runnerUp.hypothesis,
    margin,
    fits,
    ...decide(best, runnerUp, margin, thresholds, vector.distinctCards.exact !== null),
  };
}

/**
 * From explanation to action.
 *
 * The gap between the best explanation and the next matters as much as the winner. A margin too
 * narrow to be meaningful means the traffic is genuinely ambiguous, and the honest response to
 * ambiguity is a person, not an automatic action against a shopper.
 */
function decide(
  best: HypothesisFit,
  runnerUp: HypothesisFit,
  margin: number,
  thresholds: Thresholds,
  countsConfirmed: boolean,
): { decision: Decision; abstained: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (best.hypothesis === 'insufficient_evidence') {
    return {
      decision: 'monitor',
      abstained: true,
      reasons: ['not_enough_to_judge'],
    };
  }

  if (margin < thresholds.arbitrationMargin) {
    // Two explanations fit about as well. Which is another way of saying we do not know.
    reasons.push('margin_too_narrow', `runner_up_${runnerUp.hypothesis}`);
    return { decision: 'review', abstained: true, reasons };
  }

  if (SUPPRESSING.includes(best.hypothesis)) {
    // Not merely "no attack found" — a better explanation, which the console shows as the
    // argument against acting.
    reasons.push(`suppressed_by_${best.hypothesis}`);
    return {
      decision: best.hypothesis === 'outage' ? 'monitor' : 'none',
      abstained: false,
      reasons,
    };
  }

  if (best.support < thresholds.containmentSupport) {
    reasons.push('attack_best_but_weakly_supported');
    return { decision: 'review', abstained: false, reasons };
  }

  // An explicit gate rather than something the weights happen to produce, because this is the
  // one decision that touches a shopper. The attack case can otherwise reach the containment
  // floor on rate, spread of failure and amount alone — every one of which is real evidence,
  // and none of which is the card count the case is actually about. A sketch exists to find
  // candidates; confirming it is what earns the right to act.
  if (!countsConfirmed) {
    reasons.push('counts_not_confirmed');
    return { decision: 'review', abstained: false, reasons };
  }

  reasons.push('attack_clearly_best_supported');
  return { decision: 'contain', abstained: false, reasons };
}

/**
 * What the wrong call would cost, for the explanation that won and for the one behind it.
 *
 * Structured rather than written out, like everything else a rule produces. The point of
 * surfacing it is that the two costs are not symmetric and never have been: containing during
 * an outage turns somebody else's failure into your own, while failing to contain an attack
 * costs a stream of small authorisations and the chargebacks behind them.
 */
export interface Counterfactual {
  hypothesis: Hypothesis;
  ifWrongToAct: string;
  ifWrongToWait: string;
}

const COST: Record<Hypothesis, { act: string; wait: string }> = {
  attack: {
    act: 'blocked_a_real_shopper',
    wait: 'card_testing_continues_and_chargebacks_follow',
  },
  outage: {
    act: 'punished_customers_for_an_acquirer_outage',
    wait: 'nothing_extra_the_outage_is_not_ours_to_fix',
  },
  retry_storm: {
    act: 'stopped_a_merchant_collecting_money_it_is_owed',
    wait: 'nothing_extra_the_schedule_completes',
  },
  healthy_traffic: {
    act: 'turned_away_paying_customers_at_the_busiest_moment',
    wait: 'nothing_extra_this_is_the_business_working',
  },
  insufficient_evidence: {
    act: 'acted_on_something_nobody_understood',
    wait: 'an_analyst_spends_a_few_minutes_looking',
  },
};

export const counterfactualFor = (hypothesis: Hypothesis): Counterfactual => ({
  hypothesis,
  ifWrongToAct: COST[hypothesis].act,
  ifWrongToWait: COST[hypothesis].wait,
});

/** Evidence rows for the winning explanation, so it renders beside the rule evidence. */
export function expectationsAsEvidence(fit: HypothesisFit): Evidence[] {
  return fit.expectations.map((e) => ({
    rule: fit.hypothesis as unknown as Evidence['rule'],
    code: e.code,
    observed: e.observed,
    threshold: e.expected,
    weight: e.met ? e.weight : 0,
  }));
}
