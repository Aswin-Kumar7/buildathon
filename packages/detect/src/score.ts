/**
 * Turning rule outcomes into one number, without losing what produced it.
 *
 * Additive on purpose. A product of probabilities, or a learned combination, would score just
 * as well and could not be read aloud — and this tier's entire justification is that a person
 * can follow it. The score is the sum of the evidence, every term is in the list, and removing
 * a term changes the number by exactly its weight.
 *
 * The band is where missing information goes. A rule that could not run is not a rule that
 * found nothing: if the confirmation pass has not happened, `card_spread` might have fired at
 * 0.5 or not at all, and a system that quietly scored that as 0 would be treating an absence
 * of evidence as evidence of absence — against a shopper. So abstentions widen the interval in
 * the direction they could have moved it, and a wide interval is itself a reason to wait
 * rather than act.
 */

import type { Evidence, RuleId, RuleOutcome } from './rules.js';

/**
 * What each rule contributes when it fires, summed across its evidence.
 *
 * Duplicated from the rule bodies deliberately, and asserted equal to them in the tests. The
 * band needs to know what an abstaining rule *would* have contributed, which is not derivable
 * from an outcome that never happened.
 */
export const RULE_WEIGHT: Record<RuleId, number> = {
  velocity: 0.2,
  card_spread: 0.5,
  approval_collapse: 0.25,
  reason_mix: 0.2,
  small_amount_probing: 0.15,
  machine_cadence: 0.1,
  recovery: -0.4,
  infrastructure_attribution: -0.5,
  card_reuse: -0.25,
};

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface Score {
  /** Clamped to [0, 1]. Zero means nothing incriminating survived the mitigations. */
  value: number;
  /** The lowest and highest this could be, given the rules that could not run. */
  lower: number;
  upper: number;
  band: ConfidenceBand;
  /** Weight above zero, before mitigations. Shown so a reader can see what was subtracted. */
  incriminating: number;
  mitigating: number;
  evidence: Evidence[];
  /** Rules that could not run, and why. An empty list is what makes a band `high`. */
  abstentions: { rule: RuleId; reason: NonNullable<RuleOutcome['abstained']> }[];
}

const clamp = (value: number): number => Math.min(Math.max(value, 0), 1);

/** Rounded to three places so a score is comparable across runs and readable in a table. */
const round = (value: number): number => Math.round(value * 1000) / 1000;

export function scoreOutcomes(outcomes: readonly RuleOutcome[]): Score {
  const evidence = outcomes.flatMap((outcome) => outcome.evidence);

  let incriminating = 0;
  let mitigating = 0;
  for (const item of evidence) {
    if (item.weight >= 0) incriminating += item.weight;
    else mitigating += item.weight;
  }

  const abstentions = outcomes
    .filter((outcome) => outcome.abstained !== undefined)
    .map((outcome) => ({ rule: outcome.rule, reason: outcome.abstained! }));

  // How far the score could move if every silent rule turned out to have something to say.
  let couldRise = 0;
  let couldFall = 0;
  for (const { rule } of abstentions) {
    const weight = RULE_WEIGHT[rule];
    if (weight >= 0) couldRise += weight;
    else couldFall += weight;
  }

  const value = clamp(incriminating + mitigating);
  const lower = clamp(incriminating + mitigating + couldFall);
  const upper = clamp(incriminating + mitigating + couldRise);
  const width = upper - lower;

  return {
    value: round(value),
    lower: round(lower),
    upper: round(upper),
    // A band is about how much is unknown, not about how alarming the number is. A confident
    // zero and a confident one are both `high`.
    band: width === 0 ? 'high' : width <= 0.25 ? 'medium' : 'low',
    incriminating: round(incriminating),
    mitigating: round(mitigating),
    evidence,
    abstentions,
  };
}
