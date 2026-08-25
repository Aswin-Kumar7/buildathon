/**
 * The wording for everything the policy engine emits.
 *
 * Same arrangement as the rule evidence and the hypothesis expectations: the engine emits codes
 * so a decision can be counted, compared and tested, and the sentences live here where changing
 * them cannot change what was decided. A code with no entry still renders — legibly, with its
 * underscores removed — because a missing phrase must never make a refusal disappear.
 */

const ACTION_LABELS: Record<string, string> = {
  observe: 'Watch',
  step_up: 'Ask for another factor',
  contain: 'Refuse further attempts',
  escalate: 'Put in front of a person',
  release: 'Lift the containment',
};

export const actionLabel = (action: string): string =>
  ACTION_LABELS[action] ?? action.replace(/_/g, ' ');

const CODES: Record<string, string> = {
  // Refusals — the half that matters most, because an incident nobody acted on needs to say why.
  kill_switch_engaged:
    'The kill switch is engaged. Nothing that touches a customer may happen at all.',
  entity_is_allowlisted:
    'This entity is on the allowlist and is never acted against, whatever the evidence.',
  feature_state_is_stale:
    'The features are older than the policy allows. If we cannot see clearly, we do not act.',
  counts_never_confirmed:
    'The card counts were estimated and never confirmed, and nobody is contained on an estimate.',
  arbitration_abstained: 'The detector declined to decide, which is not a basis for acting.',
  too_many_active_containments:
    'As many containments are already in place as the policy allows at once.',
  hourly_containment_cap_reached: 'The hourly containment cap has been reached.',
  would_contain_too_much_of_the_shop:
    'This would put too much of the shop behind a block at once — a confident mistake at that size is a large one.',
  suppressed_by_outage:
    'An acquirer outage explains this better, and containing would punish customers for it.',
  suppressed_by_retry_storm:
    'A biller working through renewals explains this better, and containing would stop a merchant collecting.',
  suppressed_by_healthy_traffic: 'Ordinary traffic explains this better than an attack does.',
  suppressed_by_insufficient_evidence: 'There is not enough here to justify anything.',

  // Reasons.
  degraded_or_capped_so_escalated_instead:
    'Something stronger was warranted but not permitted, so this went to a person instead.',
  impact_above_dual_approval_threshold:
    'The cost of being wrong is above the threshold, so two people must agree.',
  evaluated_in_replay_time:
    'Judged standing at the moment of the replayed data rather than now. This blocks nobody real.',
  better_explanation_outage: 'The best explanation is an acquirer outage.',
  better_explanation_retry_storm: 'The best explanation is a biller retrying.',
  better_explanation_healthy_traffic: 'The best explanation is ordinary traffic.',
  better_explanation_insufficient_evidence: 'There is not enough evidence to explain it.',
};

export function decisionCode(code: string): string {
  const known = CODES[code];
  if (known !== undefined) return known;

  // `attack_supported_at_0.93` and anything else parameterised.
  const supported = /^attack_supported_at_([0-9.]+)$/.exec(code);
  if (supported !== null) {
    return `The attack explanation fits ${Math.round(Number(supported[1]) * 100)}% of what it expects.`;
  }

  return code.replace(/_/g, ' ');
}

/** Paise to rupees, for figures that are estimates and should not look like measurements. */
export const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
