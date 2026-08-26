/**
 * Where the learned model stops being a passenger.
 *
 * Arbitration reaches a decision from the rules alone. This combines that decision with the model's
 * verdict, and lets the model *move* it — but on a short, deliberate leash:
 *
 * - It can **escalate**: the rules found nothing worth a person's time, but the model is confident
 *   this is an attack, so the case goes to review. This is how the model catches what a
 *   single-entity rule structurally cannot — a distributed or low-and-slow attack.
 * - It can **de-escalate**: the rules want to contain, but the model is confident it is *not* an
 *   attack, so containment is downgraded to review rather than taken automatically.
 * - It can **corroborate**: the rules are already acting and the model agrees — no change, recorded.
 *
 * The leash, stated once and enforced here: the model **never turns anything into a containment on
 * its own** — the strongest thing it can do to a shopper is send their case to a human. It is
 * **ignored when it abstains or is absent** (the `degraded:model` path), and ignored below a
 * confidence floor. Containment still needs the deterministic evidence arbitration already required;
 * the model can only ever argue for *less* automatic action against a shopper, or for a person to
 * look where the rules would not have.
 */

import type { Arbitration, Decision } from './hypothesis.js';
import { THRESHOLDS, type Thresholds } from './thresholds.js';

/** The model's verdict, reduced to what a decision needs: its risk score, P(abuse). */
export interface ModelVerdict {
  risk: number;
}

export type ModelInfluence = 'none' | 'corroborated' | 'escalated' | 'deescalated' | 'flagged';

export interface CombinedDecision {
  decision: Decision;
  reasons: string[];
  /** How the model moved the rule-based decision — the audit trail of a model that actually decided. */
  influence: ModelInfluence;
}

const ACTIONABLE: readonly Decision[] = ['contain', 'review'];

/**
 * The hypotheses that are a positive benign explanation — the arbitration did not merely fail to
 * find an attack, it identified a specific innocent cause. The model may not raise or escalate a
 * case over one of these: a binary risk score cannot tell an outage from a masked attack, but the
 * deterministic arbitration can, and where it is confident that the traffic is a biller's dunning, an
 * acquirer outage or an ordinary busy hour, that explanation wins over the model's volume-driven
 * suspicion. `insufficient_evidence` is *not* here: an arbitration that could not decide is exactly
 * where the model is allowed to speak.
 */
const BENIGN_HYPOTHESES: readonly string[] = ['healthy_traffic', 'retry_storm', 'outage'];

/** Whether the arbitration positively identified an innocent cause, which vetoes the model's push. */
export const arbitrationExplainsBenign = (best: string): boolean =>
  BENIGN_HYPOTHESES.includes(best);

/**
 * Combine rule-based arbitration with the model's risk score into the decision actually taken.
 *
 * The model calls it an attack only at high risk and benign only at low risk; the wide band between
 * is where it stays a passenger and the rules decide alone. That band is deliberately wide — the
 * model's own block threshold is far lower, tuned for its recall, but *moving* a rules-based decision
 * is a stronger act and asks for more confidence than scoring one.
 */
export function combineDecision(
  arbitration: Pick<Arbitration, 'decision' | 'reasons' | 'best'>,
  model: ModelVerdict | null,
  thresholds: Thresholds = THRESHOLDS,
): CombinedDecision {
  const rules: CombinedDecision = {
    decision: arbitration.decision,
    reasons: [...arbitration.reasons],
    influence: 'none',
  };

  // The leash: no model at all (a missing artefact, the `degraded:model` path) — the rules decide
  // alone.
  if (model === null) return rules;

  const saysAttack = model.risk >= thresholds.modelHighRisk;
  const saysBenign = model.risk <= thresholds.modelLowRisk;
  const rulesActing = ACTIONABLE.includes(arbitration.decision);

  // Escalate: the rules did not warrant a person, but the model is confident this is an attack — and
  // the arbitration did not positively explain the traffic as benign. Where it did (a confident
  // outage, dunning or ordinary hour), that deterministic explanation overrules the model's push,
  // which is what stops a high-volume-but-innocent entity being escalated on the model's word alone.
  if (saysAttack && !rulesActing && !arbitrationExplainsBenign(arbitration.best)) {
    return {
      decision: 'review',
      reasons: [...rules.reasons, 'model_flagged_high_risk'],
      influence: 'escalated',
    };
  }

  // De-escalate: the rules want to contain, but the model scores this low-risk. Never block a shopper
  // automatically over the model's objection — send it to a person instead.
  if (saysBenign && arbitration.decision === 'contain') {
    return {
      decision: 'review',
      reasons: [...rules.reasons, 'model_scores_low_risk'],
      influence: 'deescalated',
    };
  }

  // Corroborate: the rules are already acting and the model agrees. No change, but recorded, because
  // "the model concurred" is part of why a person should trust the call.
  if (saysAttack && rulesActing) {
    return {
      decision: arbitration.decision,
      reasons: [...rules.reasons, 'model_agrees_attack'],
      influence: 'corroborated',
    };
  }

  return rules;
}

/**
 * Whether the model alone warrants raising a case on an entity the rules opened nothing for.
 *
 * This is the model earning its place in the live path: the distributed attack spread so thin that
 * no single entity trips a rule, which a burst gate cannot see but a calibrated classifier trained
 * to tell an attack from a retry storm can. A higher confidence bar than the ordinary escalation,
 * because opening a case where the rules were silent is a stronger claim — and it only ever routes
 * to review, never containment.
 */
export function modelFlagsMissedEntity(
  model: ModelVerdict | null,
  thresholds: Thresholds = THRESHOLDS,
): boolean {
  return model !== null && model.risk >= thresholds.modelFlagRisk;
}
