/**
 * The verified facts a recommendation may be built from — and the line this package will not cross.
 *
 * Every value the merchant reads is bound here, in code, from the incident's already-computed record
 * and the policy engine's read-only preview. The reasoning tier (an LLM, or a deterministic
 * heuristic) only ever chooses *which* grounded claims to make, by id. It never supplies a number, a
 * card, an identity, a count, or a timestamp. That is the whole difference between a manager that
 * reports what detection found and one that invents.
 *
 * The action itself is not the model's to choose freely either: it is capped by what the rules
 * recommended and what the policy engine would currently support, so the AI can never push past the
 * existing authority. It advises within the ceiling; it does not raise it.
 */

import { createHash } from 'node:crypto';

export type EntityKind = 'session' | 'device' | 'network';
export type Severity = 'low' | 'medium' | 'high';
export type Hypothesis =
  'attack' | 'outage' | 'retry_storm' | 'healthy_traffic' | 'insufficient_evidence';
export type Decision = 'contain' | 'review' | 'monitor' | 'none';
export type ModelInfluence = 'none' | 'corroborated' | 'escalated' | 'deescalated' | 'flagged';
export type PolicyAction = 'observe' | 'step_up' | 'contain' | 'escalate' | 'release';

/** The three recommendations this layer may make, ranked weakest → strongest. */
export type RiskAction = 'monitor' | 'review' | 'contain';

export interface RiskEvidence {
  rule: string;
  code: string;
  observed: number;
  threshold: number;
  /** Signed: negative is mitigating. Kept so a recommendation can surface counter-evidence. */
  weight: number;
}

export interface RiskModel {
  risk: number;
  predictedClass: string;
  band: string;
  abstained: boolean;
}

/** The read-only policy decision, folded into the facts so the ceiling and alignment can use it. */
export interface RiskPolicyPreview {
  action: PolicyAction;
  approvalsRequired: number;
  refusals: string[];
}

/**
 * Everything a recommendation may draw on for one incident. Assembled by the caller from the
 * incident's verified record plus the policy preview; this package treats it as ground truth.
 */
export interface RiskFacts {
  entityKind: EntityKind;
  severity: Severity;
  /** The canonical rule-based incident score in [0,1] — the same one the page header shows. */
  score: number;
  /** Arbitration's recommendation, already computed and stored on the incident. */
  recommendedDecision: Decision;
  attempts: number;
  failures: number;
  distinctCards: number | null;
  evidence: RiskEvidence[];
  best: Hypothesis | null;
  runnerUp: Hypothesis | null;
  /** Arbitration's margin over the runner-up, or null before arbitration existed. */
  margin: number | null;
  modelInfluence: ModelInfluence | null;
  model: RiskModel | null;
  modelAvailable: boolean;
  changeFired: { ewma: boolean; cusum: boolean } | null;
  /** True for replayed/simulated traffic: an executed action would block nobody. */
  rehearsal: boolean;
  /** The policy engine's read-only decision for this incident. */
  policy: RiskPolicyPreview;
}

const RANK: Record<RiskAction, number> = { monitor: 0, review: 1, contain: 2 };

/** Arbitration's recommendation mapped onto this layer's vocabulary (`none` → monitor). */
export function mappedAction(decision: Decision): RiskAction {
  if (decision === 'contain') return 'contain';
  if (decision === 'review') return 'review';
  return 'monitor';
}

/**
 * The strongest action the existing authority currently supports — the ceiling the AI may not
 * exceed. Contain is only on the table when the rules recommended it AND the policy engine would
 * currently propose a contain with no refusals. Otherwise the strongest honest recommendation is to
 * put it in front of a person.
 */
export function ceilingAction(facts: RiskFacts): RiskAction {
  const wanted = mappedAction(facts.recommendedDecision);
  if (wanted !== 'contain') return wanted;
  const policySupportsContain =
    facts.policy.action === 'contain' && facts.policy.refusals.length === 0;
  return policySupportsContain ? 'contain' : 'review';
}

/** Clamp a proposed action so it can never exceed the policy/rules ceiling. */
export function clampToCeiling(proposed: RiskAction, facts: RiskFacts): RiskAction {
  const ceiling = ceilingAction(facts);
  return RANK[proposed] <= RANK[ceiling] ? proposed : ceiling;
}

/** Whether contain was held back — i.e. the rules wanted it but policy would not currently support it. */
export function containDowngraded(facts: RiskFacts): boolean {
  return (
    mappedAction(facts.recommendedDecision) === 'contain' && ceilingAction(facts) !== 'contain'
  );
}

/**
 * Alignment: is the final recommendation consistent with both the policy preview and the model?
 * It diverges when contain was downgraded by policy, or when the model actively moved the rule
 * decision (escalated/de-escalated) rather than simply agreeing.
 */
export function alignmentOf(facts: RiskFacts, finalAction: RiskAction): 'aligned' | 'diverges' {
  if (finalAction !== mappedAction(facts.recommendedDecision)) return 'diverges';
  if (containDowngraded(facts)) return 'diverges';
  if (facts.modelInfluence === 'escalated' || facts.modelInfluence === 'deescalated') {
    return 'diverges';
  }
  return 'aligned';
}

/**
 * A stable fingerprint of the facts, so identical evidence yields an identical recommendation and a
 * replay is keyed to what a live run once saw. Evidence is sorted by code first: the order rules
 * fire in is not a change in what happened and must not change the hash.
 */
export function groundingHash(facts: RiskFacts): string {
  const evidence = [...facts.evidence]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((e) => [e.code, e.observed, e.threshold, e.weight]);

  const canonical = JSON.stringify([
    facts.entityKind,
    facts.severity,
    round(facts.score),
    facts.recommendedDecision,
    facts.attempts,
    facts.failures,
    facts.distinctCards,
    evidence,
    facts.best,
    facts.runnerUp,
    facts.margin === null ? null : round(facts.margin),
    facts.modelInfluence,
    facts.model === null
      ? null
      : [
          facts.model.predictedClass,
          round(facts.model.risk),
          facts.model.band,
          facts.model.abstained,
        ],
    facts.modelAvailable,
    facts.changeFired,
    facts.rehearsal,
    [facts.policy.action, facts.policy.approvalsRequired, [...facts.policy.refusals].sort()],
  ]);

  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
