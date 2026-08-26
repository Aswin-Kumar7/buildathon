/**
 * The facts a narrative is allowed to be built from — and the hard line this whole package draws.
 *
 * Every value a reader sees, every count and threshold and percentage, comes from here: the
 * structured output of detection and arbitration, already computed and already verified. The model
 * that writes the narrative never supplies a value. It selects which of a fixed set of atomic
 * claims to make, and in what order, by returning claim identifiers — nothing else. The numbers are
 * bound to those claims here, in code, so a narrative cannot state a figure that did not come from
 * the evidence. That is the difference between a model that reports and a model that invents.
 *
 * The hash of the facts is what a narrative is cached against and what a replay is keyed on: the
 * same evidence must always produce the same account, or "the model said something different this
 * time" becomes indistinguishable from a real change in what happened.
 */

import { createHash } from 'node:crypto';

export type Hypothesis =
  'attack' | 'outage' | 'retry_storm' | 'healthy_traffic' | 'insufficient_evidence';

export type Decision = 'contain' | 'review' | 'monitor' | 'none';

export type EntityKind = 'session' | 'device' | 'network';

export type Severity = 'low' | 'medium' | 'high';

/** One rule's observation, carried verbatim from the incident — a code and two numbers, never prose. */
export interface NarrationEvidence {
  rule: string;
  code: string;
  observed: number;
  threshold: number;
  /** Signed: negative is mitigating. Kept so a narrative can surface counter-evidence, not bury it. */
  weight: number;
}

/** The model's own risk score, when there is one, as a fact to be narrated rather than trusted. */
export interface NarrationModel {
  /** P(abuse), the served risk score. */
  risk: number;
  predictedClass: string;
  abstained: boolean;
}

/**
 * Everything a narrative may draw on for one incident. Assembled by the caller from the incident's
 * already-computed record; this package treats it as ground truth and never reaches past it.
 */
export interface NarrationFacts {
  entityKind: EntityKind;
  severity: Severity;
  score: number;
  /** Milliseconds from first attempt to detection, or null when it was never computed. */
  timeToDetectMs: number | null;
  evidence: NarrationEvidence[];
  /** Arbitration's best explanation and the one it beat, or null before arbitration existed. */
  best: Hypothesis | null;
  runnerUp: Hypothesis | null;
  decision: Decision | null;
  /** Which change-detection alarms fired across the shop's traffic, or null when not evaluated. */
  changeFired: { ewma: boolean; cusum: boolean } | null;
  model: NarrationModel | null;
}

/**
 * A stable fingerprint of the facts, so identical evidence caches and replays to an identical
 * narrative. The evidence list is sorted by code first: the order rules happen to fire in is not a
 * change in what happened, and must not change the hash.
 */
export function evidenceHash(facts: NarrationFacts): string {
  const evidence = [...facts.evidence]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((e) => [e.code, e.observed, e.threshold, e.weight]);

  const canonical = JSON.stringify([
    facts.entityKind,
    facts.severity,
    round(facts.score),
    facts.timeToDetectMs,
    evidence,
    facts.best,
    facts.runnerUp,
    facts.decision,
    facts.changeFired,
    facts.model === null
      ? null
      : [facts.model.predictedClass, round(facts.model.risk), facts.model.abstained],
  ]);

  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

// Scores and confidences are floats; two runs that differ in the fifteenth decimal are the same
// evidence and must hash the same. Rounding here is what makes the cache key stable.
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
