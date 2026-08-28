/**
 * The catalog of atomic claims — the entire vocabulary a recommendation can be built from.
 *
 * Each claim has a stable id, and a `produce` that either binds its values from the verified facts
 * and renders one grounded sentence, or returns null when the claim does not apply. The reasoning
 * tier chooses *which* ids; `produce` supplies the words and the numbers. A model cannot change a
 * value, invent a unit, or write a sentence that is not one of these — the most it can do is name a
 * claim that does not apply, and the fact guard drops that before it is ever shown.
 *
 * The action label, the one-line rationale and the alignment note are bound here too, so not one
 * merchant-facing word is authored by the model.
 */

import {
  ceilingAction,
  containDowngraded,
  type RiskAction,
  type RiskFacts,
  type Hypothesis,
} from './facts.js';

export interface ProducedClaim {
  id: string;
  text: string;
  /** The evidence codes / fact keys this claim's values were bound from, for traceability. */
  evidence: string[];
}

export interface Claim {
  readonly id: string;
  produce(facts: RiskFacts): ProducedClaim | null;
}

function claim(id: string, produce: (facts: RiskFacts) => Omit<ProducedClaim, 'id'> | null): Claim {
  return {
    id,
    produce(facts) {
      const bound = produce(facts);
      return bound === null ? null : { id, ...bound };
    },
  };
}

const integer = (n: number): string => Math.round(n).toLocaleString('en-IN');
const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

const ENTITY: Record<RiskFacts['entityKind'], string> = {
  session: 'one checkout session',
  device: 'one device',
  network: 'one network',
};
const ENTITY_SHORT: Record<RiskFacts['entityKind'], string> = {
  session: 'session',
  device: 'device',
  network: 'network',
};
const HYPOTHESIS: Record<Hypothesis, string> = {
  attack: 'card testing',
  outage: 'an acquirer outage',
  retry_storm: 'a biller retrying',
  healthy_traffic: 'ordinary traffic',
  insufficient_evidence: 'not yet enough to say',
};

function hasCode(facts: RiskFacts, code: string): boolean {
  return facts.evidence.some((e) => e.code === code && e.weight > 0);
}
function observedFor(facts: RiskFacts, code: string): number | null {
  const row = facts.evidence.find((e) => e.code === code);
  return row?.observed ?? null;
}

/**
 * The reason catalog — the grounded "why". Concise phrases suited to a short list, each bound from a
 * real count or a real triggered rule. Declaration order doubles as the template/local ordering.
 */
export const REASON_CATALOG: readonly Claim[] = [
  claim('attempt_volume', (f) =>
    f.attempts > 0
      ? {
          text: `${integer(f.attempts)} payment attempts against ${ENTITY[f.entityKind]}`,
          evidence: ['attempts'],
        }
      : null,
  ),
  claim('distinct_cards', (f) =>
    f.distinctCards !== null && f.distinctCards > 1
      ? {
          text: `${integer(f.distinctCards)} different cards from ${ENTITY[f.entityKind]}`,
          evidence: ['distinctCards'],
        }
      : null,
  ),
  claim('failure_concentration', (f) =>
    f.attempts > 0 && f.failures > 0
      ? {
          text: `${integer(f.failures)} of ${integer(f.attempts)} attempts failed`,
          evidence: ['failures', 'attempts'],
        }
      : null,
  ),
  claim('approval_collapse', (f) => {
    const observed = observedFor(f, 'approval_collapse');
    return hasCode(f, 'approval_collapse') && observed !== null
      ? { text: `approval rate fell to ${percent(observed)}`, evidence: ['approval_collapse'] }
      : null;
  }),
  claim('small_amount_probing', (f) =>
    hasCode(f, 'small_amount_probing')
      ? { text: 'mostly small, probing amounts', evidence: ['small_amount_probing'] }
      : null,
  ),
  claim('machine_cadence', (f) =>
    hasCode(f, 'machine_cadence')
      ? { text: 'a machine-like arrival cadence', evidence: ['machine_cadence'] }
      : null,
  ),
  claim('arbitration', (f) =>
    f.best !== null && f.best === 'attack'
      ? {
          text:
            f.runnerUp !== null && f.runnerUp !== f.best
              ? `arbitration read this as ${HYPOTHESIS[f.best]} over ${HYPOTHESIS[f.runnerUp]}`
              : `arbitration read this as ${HYPOTHESIS[f.best]}`,
          evidence: ['arbitration'],
        }
      : null,
  ),
  claim('model_corroborates', (f) =>
    f.model === null || f.model.abstained
      ? null
      : {
          text:
            f.modelInfluence === 'flagged'
              ? `the model raised this on its own at ${percent(f.model.risk)} risk`
              : `the model reads this as ${f.model.predictedClass === 'benign' ? 'low risk' : 'card testing'} at ${percent(f.model.risk)}`,
          evidence: ['model'],
        },
  ),
  claim('mitigating_recovery', (f) =>
    hasCode(f, 'recovery') || f.evidence.some((e) => e.code === 'recovery')
      ? { text: 'some failing payments recovered on their own', evidence: ['recovery'] }
      : null,
  ),
  claim('mitigating_infra', (f) =>
    f.evidence.some((e) => e.code === 'infrastructure_attribution')
      ? {
          text: 'some failures were attributed to the gateway, not the card',
          evidence: ['infrastructure_attribution'],
        }
      : null,
  ),
];

export const REASON_IDS: ReadonlySet<string> = new Set(REASON_CATALOG.map((c) => c.id));

/**
 * The "what would change" catalog — how additional evidence could move the recommendation. These
 * describe the system's real behaviour, not incident-specific values, so nothing here is fabricated.
 */
export const CHANGE_CATALOG: readonly Claim[] = [
  claim('attempts_stop', () => ({
    text: 'If the attempts stop for the idle window, the incident expires on its own.',
    evidence: ['mechanism'],
  })),
  claim('cards_recover', (f) =>
    f.failures > 0
      ? {
          text: 'If the failing cards start succeeding, this looks less like testing and more like a bad minute.',
          evidence: ['mechanism'],
        }
      : null,
  ),
  claim('margin_narrows', (f) =>
    f.best === 'attack' && f.margin !== null
      ? {
          text: 'If a competing explanation fits as well, arbitration routes this to review instead of containment.',
          evidence: ['arbitration'],
        }
      : null,
  ),
  claim('model_drops', (f) =>
    f.model !== null
      ? {
          text: "If the model's read falls below its threshold, it stops corroborating the rules.",
          evidence: ['model'],
        }
      : null,
  ),
  claim('features_stale', () => ({
    text: 'If the feature snapshot goes stale, policy refuses containment until it refreshes.',
    evidence: ['policy'],
  })),
  claim('analyst_verdict', () => ({
    text: "An analyst's confirmed verdict settles the label either way.",
    evidence: ['mechanism'],
  })),
];

export const CHANGE_IDS: ReadonlySet<string> = new Set(CHANGE_CATALOG.map((c) => c.id));

/** The claims that apply to these facts, in catalog order, each already bound. */
export function availableReasons(facts: RiskFacts): ProducedClaim[] {
  return REASON_CATALOG.map((c) => c.produce(facts)).filter((p): p is ProducedClaim => p !== null);
}
export function availableChanges(facts: RiskFacts): ProducedClaim[] {
  return CHANGE_CATALOG.map((c) => c.produce(facts)).filter((p): p is ProducedClaim => p !== null);
}

// ---- Bound labels and one-liners (never model-authored) --------------------------------------

export const ACTION_LABEL: Record<RiskAction, string> = {
  contain: 'Block suspicious activity',
  review: 'Review incident',
  monitor: 'Continue monitoring',
};

export const ACTION_DESCRIPTION: Record<RiskAction, string> = {
  contain: 'Apply containment to block further suspicious activity.',
  review: 'Send this incident to a person for review.',
  monitor: 'Keep watching; take no customer-impacting action.',
};

/** A single grounded summary line for the recommendation. */
export function rationaleLine(facts: RiskFacts, action: RiskAction): string {
  const entity = ENTITY_SHORT[facts.entityKind];
  if (action === 'contain') {
    return `The evidence points to card testing on this ${entity}, and policy supports containment — recommend blocking further attempts until it expires.`;
  }
  if (action === 'review') {
    return containDowngraded(facts)
      ? `The rules leaned toward containment, but policy will not currently support a block on this ${entity} — recommend routing it to a person for review.`
      : `The signals warrant a closer look but not an automatic block — recommend routing this ${entity} to review.`;
  }
  return `The activity on this ${entity} does not clear the bar for a customer-impacting action — recommend continued monitoring.`;
}

/** A bound one-liner for the alignment badge. */
export function alignmentLine(facts: RiskFacts, action: RiskAction): string {
  if (containDowngraded(facts) && action === 'review') {
    return 'The rules leaned toward containment; policy holds it for review — shown with the refusal.';
  }
  if (facts.modelInfluence === 'escalated') {
    return 'The model escalated a case the rules alone would have passed; the recommendation follows the combined call.';
  }
  if (facts.modelInfluence === 'deescalated') {
    return 'The model argued this down from containment; the recommendation follows the combined call.';
  }
  if (action === ceilingAction(facts)) {
    return 'Consistent with the policy engine and the model’s read.';
  }
  return 'Consistent with the current policy state.';
}
