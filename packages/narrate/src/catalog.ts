/**
 * The catalog of atomic claims — the entire vocabulary a narrative can be built from.
 *
 * Each claim has a stable id, a `bind` that resolves its typed slots from the verified facts (or
 * returns null when the claim does not apply to this incident), and a `render` that turns those
 * slots into one sentence. The split is the safety property: a model chooses *which* claims by id,
 * `bind` supplies the values from evidence, and `render` fixes the wording. A model cannot change a
 * number, invent a unit, or write a connective — the most it can do is choose a claim that does not
 * apply, and the fact guard drops that before it is ever rendered.
 *
 * Adding a claim is adding a row here. There is deliberately no path by which a narrative contains a
 * sentence that is not one of these renderers run over values that came from the evidence.
 */

import type { Decision, Hypothesis, NarrationFacts, Severity } from './facts.js';

type Slots = Record<string, string | number>;

/** What `bind` returns: the slot values, and the evidence codes (or fact keys) they came from. */
interface Binding<S extends Slots> {
  slots: S;
  evidence: string[];
}

export interface ProducedClaim {
  slots: Slots;
  text: string;
  /** The evidence codes / fact keys this claim's values were bound from, for traceability. */
  evidence: string[];
}

export interface Claim {
  readonly id: string;
  /** Bind and render in one step, or null when the claim does not apply to these facts. */
  produce(facts: NarrationFacts): ProducedClaim | null;
}

function claim<S extends Slots>(
  id: string,
  bind: (facts: NarrationFacts) => Binding<S> | null,
  render: (slots: S) => string,
): Claim {
  return {
    id,
    produce(facts) {
      const bound = bind(facts);
      if (bound === null) return null;
      return { slots: bound.slots, text: render(bound.slots), evidence: bound.evidence };
    },
  };
}

// The renderer owns every word a reader sees, including the names of things. These maps live here,
// not in the model, so the wording is fixed and reviewable rather than generated.
const HYPOTHESIS: Record<Hypothesis, string> = {
  attack: 'card testing',
  outage: 'an acquirer outage',
  retry_storm: 'a biller retrying',
  healthy_traffic: 'ordinary traffic',
  insufficient_evidence: 'not yet enough to say',
};

const DECISION: Record<Decision, string> = {
  contain: 'contain it',
  review: 'put it in front of a person',
  monitor: 'watch it without acting',
  none: 'leave it alone',
};

const ENTITY: Record<NarrationFacts['entityKind'], string> = {
  session: 'this checkout session',
  device: 'this device',
  network: 'this network',
};

const SEVERITY_WORD: Record<Severity, string> = { low: 'low', medium: 'moderate', high: 'high' };

// Per-evidence-code wording. A code with no entry still narrates through a safe generic renderer
// below, so a new rule is never silently unnarratable — it just reads plainly until given a phrase.
const EVIDENCE_PHRASE: Record<string, (observed: number, threshold: number) => string> = {
  velocity: (o, t) =>
    `${integer(o)} attempts came through where ${integer(t)} would already be high`,
  card_spread: (o) => `${integer(o)} different cards were tried against the one target`,
  approval_collapse: (o) => `only ${percent(o)} of attempts were approved`,
  small_amount_probing: (o) => `${percent(o)} of the attempts were tiny, probing amounts`,
  machine_cadence: (o) => `the attempts arrived on a machine-like cadence (${round2(o)})`,
  recovery: (o) => `${percent(o)} of the failing payments recovered on their own`,
  infrastructure_attribution: (o) =>
    `${percent(o)} of the failures were blamed on the gateway, not the card`,
  card_reuse: (o) => `the same ${integer(o)} cards kept being retried`,
};

const integer = (n: number): string => Math.round(n).toLocaleString('en-IN');
const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;
const round2 = (n: number): string => n.toFixed(2);
const seconds = (ms: number): string => (ms / 1000).toFixed(ms < 10_000 ? 1 : 0);

/** The strongest incriminating evidence row, used where a narrative wants the single best reason. */
function topEvidence(facts: NarrationFacts): NarrationFacts['evidence'][number] | null {
  const incriminating = facts.evidence.filter((e) => e.weight > 0);
  if (incriminating.length === 0) return null;
  return incriminating.reduce((best, e) => (e.weight > best.weight ? e : best));
}

function phraseForCode(code: string, observed: number, threshold: number): string {
  const specific = EVIDENCE_PHRASE[code];
  if (specific !== undefined) return specific(observed, threshold);
  return `${code.replace(/_/g, ' ')} came in at ${round2(observed)} against ${round2(threshold)}`;
}

/**
 * The catalog, in a stable declaration order. The template selector falls back to this order, so it
 * doubles as the canonical narrative shape: headline, then the evidence, then the decision.
 */
export const CATALOG: readonly Claim[] = [
  claim(
    'headline',
    (f) =>
      f.best === null
        ? null
        : {
            slots: { subject: ENTITY[f.entityKind], what: HYPOTHESIS[f.best] },
            evidence: ['arbitration'],
          },
    (s) => `${capitalize(String(s.subject))} looks like ${s.what}.`,
  ),

  claim(
    'severity',
    (f) => ({
      slots: { level: SEVERITY_WORD[f.severity], score: Math.round(f.score * 100) },
      evidence: ['score'],
    }),
    (s) => `The risk is ${s.level} — scored ${s.score} out of 100.`,
  ),

  claim(
    'top_reason',
    (f) => {
      const top = topEvidence(f);
      return top === null
        ? null
        : {
            slots: { reason: phraseForCode(top.code, top.observed, top.threshold) },
            evidence: [top.code],
          };
    },
    (s) => `The clearest sign: ${s.reason}.`,
  ),

  claim(
    'supporting_reason',
    (f) => {
      // The second-strongest incriminating row, so a narrative can corroborate rather than repeat.
      const incriminating = f.evidence
        .filter((e) => e.weight > 0)
        .sort((a, b) => b.weight - a.weight);
      const second = incriminating[1];
      return second === undefined
        ? null
        : {
            slots: { reason: phraseForCode(second.code, second.observed, second.threshold) },
            evidence: [second.code],
          };
    },
    (s) => `On top of that, ${s.reason}.`,
  ),

  claim(
    'mitigating',
    (f) => {
      // Counter-evidence is a first-class sentence, never omitted to make a cleaner story.
      const against = f.evidence.filter((e) => e.weight < 0).sort((a, b) => a.weight - b.weight);
      const first = against[0];
      return first === undefined
        ? null
        : {
            slots: { reason: phraseForCode(first.code, first.observed, first.threshold) },
            evidence: [first.code],
          };
    },
    (s) => `Against it, though, ${s.reason}.`,
  ),

  claim(
    'change_signal',
    (f) =>
      f.changeFired === null || (!f.changeFired.ewma && !f.changeFired.cusum)
        ? null
        : {
            slots: { which: f.changeFired.cusum ? 'a sustained shift' : 'a sharp jump' },
            evidence: ['change'],
          },
    (s) => `The shop's overall traffic showed ${s.which} at the same time.`,
  ),

  claim(
    'model_opinion',
    (f) =>
      f.model === null
        ? null
        : f.model.abstained
          ? { slots: { verb: 'was not confident enough to call it', pct: '' }, evidence: ['model'] }
          : {
              slots: {
                verb: `read it as ${HYPOTHESIS[asHypothesis(f.model.predictedClass)]}`,
                pct: percent(f.model.confidence),
              },
              evidence: ['model'],
            },
    (s) =>
      s.pct === ''
        ? `The model ${s.verb}.`
        : `The model independently ${s.verb}, at ${s.pct} confidence.`,
  ),

  claim(
    'runner_up',
    (f) =>
      f.best === null || f.runnerUp === null || f.runnerUp === f.best
        ? null
        : { slots: { alt: HYPOTHESIS[f.runnerUp] }, evidence: ['arbitration'] },
    (s) => `The nearest alternative, ${s.alt}, fit the evidence less well.`,
  ),

  claim(
    'time_to_detect',
    (f) =>
      f.timeToDetectMs === null
        ? null
        : { slots: { secs: seconds(f.timeToDetectMs) }, evidence: ['timing'] },
    (s) => `It was caught ${s.secs}s after the first attempt.`,
  ),

  claim(
    'decision',
    (f) =>
      f.decision === null
        ? null
        : { slots: { stance: DECISION[f.decision] }, evidence: ['arbitration'] },
    (s) => `The system's recommendation is to ${s.stance}.`,
  ),
];

/** Every claim id in the catalog, frozen. The fact guard treats anything outside this as unknown. */
export const CLAIM_IDS: ReadonlySet<string> = new Set(CATALOG.map((c) => c.id));

export function claimById(id: string): Claim | undefined {
  return CATALOG.find((c) => c.id === id);
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

// The model's predicted class is a free string on the wire; narrow it to a known hypothesis for
// wording, falling back to "not enough to say" rather than rendering a raw label.
function asHypothesis(value: string): Hypothesis {
  return value in HYPOTHESIS ? (value as Hypothesis) : 'insufficient_evidence';
}
