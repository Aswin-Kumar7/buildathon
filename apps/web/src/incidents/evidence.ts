import type { EvidenceDto } from '@sentinel/contracts';

/**
 * Turning rule codes into sentences, at the edge and nowhere else.
 *
 * The rules emit codes and numbers on purpose, so a reason can be counted, compared and tested
 * and cannot drift from what happened because somebody improved the wording. This is where the
 * wording lives — one place, changeable without touching a threshold, and unable to change what
 * the detector concluded.
 *
 * A code with no entry here still renders: the number and the threshold are the facts, and a
 * missing sentence must not hide them.
 */
const PHRASES: Record<string, (e: EvidenceDto) => string> = {
  attempt_rate_above_threshold: (e) =>
    `About ${e.observed.toFixed(1)} payment attempts a minute — far faster than real shoppers check out`,
  distinct_cards_above_threshold: (e) => `${e.observed} different cards, all from the same source`,
  cards_per_attempt_above_threshold: (e) =>
    `About ${e.observed.toFixed(2)} cards per attempt — a card list being worked through, not one card retried`,
  approval_rate_below_floor: (e) =>
    `Only ${Math.round(e.observed * 100)}% of attempts got approved`,
  decline_reasons_concentrated: () =>
    `The declines are almost all the same reason — real shoppers fail for many different reasons`,
  small_amount_share_above_threshold: (e) =>
    `${Math.round(e.observed * 100)}% of attempts were for tiny amounts — the cheapest way to test whether a card works`,
  inter_arrival_variation_low: () =>
    `Attempts arrived in a steady, machine-like rhythm — too even to be real people`,
  orders_recovered_after_failure: (e) =>
    `${e.observed} order${e.observed === 1 ? '' : 's'} failed and were then paid — a customer getting through, not an attacker`,
  failures_attributed_to_gateway: (e) =>
    `Razorpay blamed its own gateway for ${Math.round(e.observed * 100)}% of these failures — not the cards`,
  cards_reused_across_attempts: (e) =>
    `The same cards were tried about ${e.observed.toFixed(1)} times each — retries, which is what a biller does`,
};

export const phraseFor = (evidence: EvidenceDto): string =>
  PHRASES[evidence.code]?.(evidence) ??
  `${evidence.code.replace(/_/g, ' ')}: ${evidence.observed} against ${evidence.threshold}`;

/** Why a rule could not run. Silence and a finding are different things and must read as such. */
export const ABSTENTION_REASON: Record<string, string> = {
  'insufficient-data': 'not enough activity to judge this yet',
  'unconfirmed-estimate': 'only an estimate so far — not confirmed, so not decided on',
};

const RULE_NAMES: Record<string, string> = {
  velocity: 'Rate',
  card_spread: 'Card spread',
  approval_collapse: 'Approval rate',
  reason_mix: 'Decline reasons',
  small_amount_probing: 'Small amounts',
  machine_cadence: 'Timing',
  recovery: 'Recovery',
  infrastructure_attribution: 'Infrastructure',
  card_reuse: 'Card reuse',
};

export const ruleName = (rule: string): string => RULE_NAMES[rule] ?? rule.replace(/_/g, ' ');

/**
 * What a person might reasonably do next.
 *
 * A suggestion, and labelled as one everywhere it appears. Nothing here acts, and nothing here
 * is a policy — containment and approval arrive in a later slice, and pretending otherwise
 * would be the console claiming a power it does not have.
 */
export function suggestedAction(severity: string, firedRules: readonly string[]): string {
  if (firedRules.includes('infrastructure_attribution')) {
    return 'Check with the acquirer before doing anything — this looks like their outage';
  }
  if (firedRules.includes('card_reuse')) return 'Probably a biller retrying. Confirm, then close';
  if (severity === 'high') return 'Worth containing once someone has read the evidence';
  if (severity === 'medium') return 'Worth a look before it grows';
  return 'Watch — not yet worth acting on';
}

const HYPOTHESIS_NAMES: Record<string, string> = {
  attack: 'Card testing',
  outage: 'Acquirer outage',
  retry_storm: 'Biller retrying',
  healthy_traffic: 'Ordinary traffic',
  insufficient_evidence: 'Not enough to say',
};

export const hypothesisName = (hypothesis: string): string =>
  HYPOTHESIS_NAMES[hypothesis] ?? hypothesis.replace(/_/g, ' ');

const DECISION_LABELS: Record<string, string> = {
  contain: 'Block the suspicious activity',
  review: 'Have someone review it',
  monitor: 'Keep monitoring',
  none: 'Leave it for now',
};

export const decisionLabel = (decision: string): string =>
  DECISION_LABELS[decision] ?? decision.replace(/_/g, ' ');

/**
 * What each hypothesis expected the traffic to look like.
 *
 * Same arrangement as the rule evidence: the detector emits a code, the wording lives here, and
 * a code with no entry still renders with its numbers rather than vanishing.
 */
const EXPECTATION_PHRASES: Record<string, string> = {
  enough_attempts_to_have_a_shape: 'enough attempts for the shape to mean anything',
  many_distinct_cards: 'many different cards',
  card_per_attempt_high: 'close to a new card every attempt',
  approval_collapsed: 'almost nothing approved',
  failure_not_the_gateways: 'the gateway was not blamed',
  not_ordinary_busy_traffic: 'not just a busy afternoon',
  small_amounts: 'trivial amounts, the cheap way to test a card',
  shop_failing_with_nobody_to_blame: 'the whole shop failing with nobody to blame',
  gateway_blamed: 'Razorpay blamed its own gateway',
  failure_is_widespread: 'failure spread across unrelated shoppers',
  this_entity_blamed_the_gateway_too: 'this entity blamed the gateway too',
  no_card_walking: 'nobody working through a card list',
  cards_reused: 'the same cards tried again',
  few_distinct_cards: 'only a handful of cards',
  not_the_gateways_fault: 'not the gateway',
  runs_on_a_timer: 'arrivals on a schedule',
  some_of_it_works: 'some of it is going through',
  most_payments_succeed: 'most payments succeeding',
  many_shoppers: 'many different shoppers',
  failure_is_thin_on_the_ground: 'failure is rare here',
  nobody_is_walking_a_card_list: 'nobody working through a card list',
  barely_any_activity: 'barely any activity to judge',
  counts_never_confirmed: 'the counts were never confirmed',
  little_to_compare_against: 'little else to compare against',
};

export function expectationPhrase(expectation: {
  code: string;
  observed: number;
  expected: number;
}): string {
  const numbers = `${Number(expectation.observed.toFixed(2))} against ${Number(expectation.expected.toFixed(2))}`;
  const wording = EXPECTATION_PHRASES[expectation.code];

  return wording === undefined
    ? `${expectation.code.replace(/_/g, ' ')} — ${numbers}`
    : `${wording} (${numbers})`;
}

/**
 * The cost of getting it wrong, in either direction.
 *
 * Worth spelling out because the two are never equal: containing during an outage turns another
 * party's failure into your own, and the reader should see both halves rather than be told the
 * system weighed them.
 */
const COSTS: Record<string, string> = {
  blocked_a_real_shopper: 'a real shopper is blocked at checkout',
  card_testing_continues_and_chargebacks_follow:
    'the card testing carries on, and the chargebacks follow',
  punished_customers_for_an_acquirer_outage:
    'customers are punished for an outage that is not theirs or ours',
  nothing_extra_the_outage_is_not_ours_to_fix: 'nothing extra — the outage is not ours to fix',
  stopped_a_merchant_collecting_money_it_is_owed:
    'a merchant is stopped from collecting money it is owed',
  nothing_extra_the_schedule_completes: 'nothing extra — the retry schedule finishes on its own',
  turned_away_paying_customers_at_the_busiest_moment:
    'paying customers are turned away at the busiest moment',
  nothing_extra_this_is_the_business_working: 'nothing extra — this is the business working',
  acted_on_something_nobody_understood: 'we acted on something nobody understood',
  an_analyst_spends_a_few_minutes_looking: 'an analyst spends a few minutes looking',
};

export const costPhrase = (code: string): string => COSTS[code] ?? code.replace(/_/g, ' ');

/* ------------------------------------------------------------------------------------------------
 * Evidence & signals table
 *
 * Merchant-readable names and value formatting for the triggered-rules table. Same rule as the rest
 * of this file: the detector emits a code and two numbers, the wording and units live here in one
 * place, and a code with no entry still renders its raw numbers rather than vanishing. Nothing here
 * is incident data — only how a code is named and how its real observed/threshold are formatted.
 * ---------------------------------------------------------------------------------------------- */

/** A short, merchant-facing name for one evidence code (the strong label on a triggered-rule row). */
const SIGNAL_LABEL: Record<string, string> = {
  attempt_rate_above_threshold: 'Payments came in unusually fast',
  distinct_cards_above_threshold: 'Many different cards were tried',
  cards_per_attempt_above_threshold: 'A different card almost every time',
  distinct_cards_long_span_above_threshold: 'Many different cards over a longer period',
  orders_per_card_above_threshold: 'One card used across many orders',
  approval_rate_below_floor: 'Almost all payments failed',
  decline_reasons_concentrated: 'Declines all point to one reason',
  small_amount_share_above_threshold: 'Mostly very small amounts',
  inter_arrival_variation_low: 'Machine-like timing',
  orders_recovered_after_failure: 'A customer paid after a failed try',
  failures_attributed_to_gateway: 'The gateway failed, not the cards',
  cards_reused_across_attempts: 'The same cards tried again',
};

/** One plain sentence describing what the signal means, for the small line under the row name. */
const SIGNAL_DESCRIPTION: Record<string, string> = {
  attempt_rate_above_threshold: 'Payments arrived faster than a shopper could check out',
  distinct_cards_above_threshold: 'Lots of different cards, all from the same place',
  cards_per_attempt_above_threshold: 'A list of cards being worked through, not one card retried',
  distinct_cards_long_span_above_threshold:
    'Lots of different cards, spread out to stay under the radar',
  orders_per_card_above_threshold: 'One card used across many different orders',
  approval_rate_below_floor: 'Almost nothing was going through',
  decline_reasons_concentrated: 'The declines nearly all share one reason',
  small_amount_share_above_threshold: 'Tiny amounts — the cheapest way to test if a card works',
  inter_arrival_variation_low: 'Attempts too evenly spaced to be real people',
  orders_recovered_after_failure: 'A shopper who got through after a failure, not an attacker',
  failures_attributed_to_gateway: 'Razorpay blamed its own gateway, not the cards',
  cards_reused_across_attempts: 'The same few cards tried again — what a biller does',
};

type EvidenceUnit = 'percent' | 'rate_min' | 'per_card' | 'ratio' | 'cards' | 'orders' | 'count';

const CODE_UNIT: Record<string, EvidenceUnit> = {
  attempt_rate_above_threshold: 'rate_min',
  distinct_cards_above_threshold: 'cards',
  distinct_cards_long_span_above_threshold: 'cards',
  cards_per_attempt_above_threshold: 'ratio',
  orders_per_card_above_threshold: 'per_card',
  approval_rate_below_floor: 'percent',
  decline_reasons_concentrated: 'ratio',
  small_amount_share_above_threshold: 'percent',
  inter_arrival_variation_low: 'ratio',
  orders_recovered_after_failure: 'orders',
  failures_attributed_to_gateway: 'percent',
  cards_reused_across_attempts: 'per_card',
};

function formatUnit(value: number, unit: EvidenceUnit): string {
  switch (unit) {
    case 'percent':
      return `${Math.round(value * 100)}%`;
    case 'rate_min':
      return `${value.toFixed(1)}/min`;
    case 'per_card':
      return `${value.toFixed(1)}×`;
    case 'ratio':
      return value.toFixed(2);
    case 'cards':
      return `${value} card${value === 1 ? '' : 's'}`;
    case 'orders':
      return `${value} order${value === 1 ? '' : 's'}`;
    default:
      return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }
}

export const signalLabel = (code: string): string => SIGNAL_LABEL[code] ?? code.replace(/_/g, ' ');
export const signalDescription = (code: string): string => SIGNAL_DESCRIPTION[code] ?? '';

/** The observed value, in its natural unit. */
export const evidenceObserved = (evidence: EvidenceDto): string =>
  formatUnit(evidence.observed, CODE_UNIT[evidence.code] ?? 'count');

/** The threshold the value was compared against, with the comparator the rule actually used. */
export const evidenceThreshold = (evidence: EvidenceDto): string => {
  const unit = CODE_UNIT[evidence.code] ?? 'count';
  const comparator = /below|floor/.test(evidence.code) ? '≤' : '≥';
  return `${comparator} ${formatUnit(evidence.threshold, unit)}`;
};

/**
 * The rule's impact tier, derived from the magnitude of its real signed weight — the backend's own
 * measure of how much this signal moved the score. Presentation of a real number, not a new score.
 */
export const evidenceImpact = (weight: number): 'high' | 'medium' | 'low' => {
  const magnitude = Math.abs(weight);
  if (magnitude >= 0.3) return 'high';
  if (magnitude >= 0.15) return 'medium';
  return 'low';
};
