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
    `Attempting ${e.observed.toFixed(1)} payments a minute, against ${e.threshold} where we start looking`,
  distinct_cards_above_threshold: (e) =>
    `${e.observed} different cards from one place, against ${e.threshold} where we start looking`,
  cards_per_attempt_above_threshold: (e) =>
    `Nearly a new card every attempt (${e.observed.toFixed(2)} per try) — a list being walked, not a card being retried`,
  approval_rate_below_floor: (e) =>
    `${Math.round(e.observed * 100)}% of attempts succeeded, against a floor of ${Math.round(e.threshold * 100)}%`,
  decline_reasons_concentrated: (e) =>
    `Declines are concentrated on one reason (${e.observed.toFixed(2)} of a possible 1.00)`,
  small_amount_share_above_threshold: (e) =>
    `${Math.round(e.observed * 100)}% of attempts were for trivial amounts — the cheapest way to test whether a card is alive`,
  inter_arrival_variation_low: (e) =>
    `Arrivals are too evenly spaced to be people (${e.observed.toFixed(2)}, where 1.00 is what human timing looks like)`,
  orders_recovered_after_failure: (e) =>
    `${e.observed} order${e.observed === 1 ? '' : 's'} failed and were then paid — a customer getting through, not an attacker`,
  failures_attributed_to_gateway: (e) =>
    `Razorpay blamed its own gateway for ${Math.round(e.observed * 100)}% of these failures, not the cards`,
  cards_reused_across_attempts: (e) =>
    `Each card was tried ${e.observed.toFixed(1)} times — the same cards retried, which is what a biller does`,
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
