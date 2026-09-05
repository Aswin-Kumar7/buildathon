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

/**
 * The codes whose rule fires when the observed value is UNDER the threshold, not over it. Listed
 * exactly rather than pattern-matched: the pattern was /below|floor/, which read
 * `approval_rate_below_floor` correctly and missed `inter_arrival_variation_low` — so the machine
 * cadence row rendered "OBSERVED 0.12 · EXPECTED LIMIT ≥ 0.35", asserting the opposite of the test
 * that fired it and making the row look like it should not have been there at all.
 *
 * `packages/detect/src/rules.ts` is the source of truth: `approvalCollapse` fires on
 * `approvalRate < approvalFloor`, `machineCadence` on `burstiness < machineCadence`. Every other
 * code fires on a greater-than.
 */
const FIRES_WHEN_UNDER: ReadonlySet<string> = new Set([
  'approval_rate_below_floor',
  'inter_arrival_variation_low',
]);

/** The threshold the value was compared against, with the comparator the rule actually used. */
export const evidenceThreshold = (evidence: EvidenceDto): string => {
  const unit = CODE_UNIT[evidence.code] ?? 'count';
  const comparator = FIRES_WHEN_UNDER.has(evidence.code) ? '≤' : '≥';
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
