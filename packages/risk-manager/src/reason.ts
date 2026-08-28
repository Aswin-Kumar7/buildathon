/**
 * The reasoning ladder and the fact guard — where selection, guarding and grounding meet.
 *
 * A tier returns a selection: one action (from a fixed set of three) and ordered lists of reason and
 * "what-would-change" claim ids. Before any of it reaches a merchant it passes the guard: an id not
 * in the catalog, or one whose claim does not apply to these facts, is dropped and counted — a
 * reasoning layer that keeps naming claims that do not exist is one going wrong, and that has to be
 * measurable. The action is clamped to what the rules and policy already support, so no tier — least
 * of all a remote model — can push past the existing authority.
 *
 * The ladder tries tiers in order and takes the first that yields a usable recommendation, with the
 * template at the bottom because it cannot fail. When the live provider goes away, replay reproduces
 * the same selection from its recording, so the recommendation a merchant sees does not change — only
 * the badge that says where it came from does.
 */

import {
  ceilingAction,
  clampToCeiling,
  alignmentOf,
  groundingHash,
  type RiskAction,
  type RiskFacts,
} from './facts.js';
import {
  ACTION_LABEL,
  alignmentLine,
  availableChanges,
  availableReasons,
  CHANGE_IDS,
  rationaleLine,
  REASON_IDS,
  type ProducedClaim,
} from './catalog.js';

export const REASONING_VERSION = 'rm-r1';

export type RiskSource = 'live' | 'local' | 'replay' | 'template';

export interface RiskSelection {
  action: RiskAction;
  reasonIds: string[];
  changeIds: string[];
  /**
   * A one-sentence rationale the live model wrote in its own words. Undefined for the deterministic
   * tiers. Validated by the prose guard before use — a fabricated number falls back to the bound line.
   */
  rationale?: string;
}

export interface RiskSelector {
  readonly source: RiskSource;
  select(
    facts: RiskFacts,
    reasons: readonly string[],
    changes: readonly string[],
    hash: string,
  ): Promise<RiskSelection> | RiskSelection;
}

/** A remote reasoner (an LLM): proposes an action id and orderings, and may be slow or unreachable. */
export interface RiskProvider {
  propose(
    facts: RiskFacts,
    reasons: readonly string[],
    changes: readonly string[],
  ): Promise<RiskSelection>;
}

/** A record of what a live reasoner chose for a grounding hash, so it can be replayed byte-identically. */
export interface RiskReplayStore {
  get(hash: string): RiskSelection | undefined;
  put(hash: string, selection: RiskSelection): void;
}

/** The assembled recommendation, less the incident id and the degraded flag the caller adds. */
export interface RiskAssessment {
  action: RiskAction;
  actionLabel: string;
  rationale: string;
  /** True when `rationale` is the model's own sentence (guard-checked), false when the bound line. */
  rationaleAuthored: boolean;
  keyReasons: ProducedClaim[];
  whatWouldChange: ProducedClaim[];
  alignment: 'aligned' | 'diverges';
  alignmentNote: string;
  refusals: string[];
  policyAction: RiskFacts['policy']['action'];
  modelAvailable: boolean;
  rehearsal: boolean;
  source: RiskSource;
  reasoningVersion: string;
  groundingHash: string;
  rationaleClaimIds: string[];
  whatWouldChangeIds: string[];
  dropped: number;
}

export class RiskUnusable extends Error {}

const VALID_ACTIONS: ReadonlySet<RiskAction> = new Set(['monitor', 'review', 'contain']);

/** The template floor: the ceiling action, every applicable reason in catalog order, every change. */
export const templateSelector: RiskSelector = {
  source: 'template',
  select: (facts, reasons, changes) => ({
    action: ceilingAction(facts),
    reasonIds: [...reasons],
    changeIds: [...changes],
  }),
};

/** The on-device tier: the ceiling action, the strongest reasons and a couple of change notes. */
export const localSelector: RiskSelector = {
  source: 'local',
  select: (facts, reasons, changes) => {
    const reasonPriority = [
      'distinct_cards',
      'attempt_volume',
      'failure_concentration',
      'approval_collapse',
      'small_amount_probing',
      'machine_cadence',
      'arbitration',
      'model_corroborates',
      'mitigating_recovery',
      'mitigating_infra',
    ];
    const changePriority = [
      'attempts_stop',
      'cards_recover',
      'margin_narrows',
      'model_drops',
      'features_stale',
      'analyst_verdict',
    ];
    const present = new Set(reasons);
    const presentChanges = new Set(changes);
    return {
      action: ceilingAction(facts),
      reasonIds: reasonPriority.filter((id) => present.has(id)).slice(0, 4),
      changeIds: changePriority.filter((id) => presentChanges.has(id)).slice(0, 3),
    };
  },
};

export function liveSelector(provider: RiskProvider): RiskSelector {
  return {
    source: 'live',
    select: async (facts, reasons, changes) => {
      const proposed = await provider.propose(facts, reasons, changes);
      if (!VALID_ACTIONS.has(proposed.action)) {
        throw new RiskUnusable(`live proposed an invalid action: ${String(proposed.action)}`);
      }
      return proposed;
    },
  };
}

export function replaySelector(store: RiskReplayStore): RiskSelector {
  return {
    source: 'replay',
    select: (_facts, _reasons, _changes, hash) => {
      const recorded = store.get(hash);
      if (recorded === undefined) throw new RiskUnusable(`no recorded recommendation for ${hash}`);
      return recorded;
    },
  };
}

/** Run one tier: select, guard, clamp, assemble. Throws {@link RiskUnusable} to descend the ladder. */
export async function assessWith(
  facts: RiskFacts,
  selector: RiskSelector,
): Promise<RiskAssessment> {
  const hash = groundingHash(facts);
  const reasons = availableReasons(facts);
  const changes = availableChanges(facts);
  const reasonById = new Map(reasons.map((c) => [c.id, c]));
  const changeById = new Map(changes.map((c) => [c.id, c]));

  const selection = await selector.select(
    facts,
    reasons.map((c) => c.id),
    changes.map((c) => c.id),
    hash,
  );

  let dropped = 0;
  const keyReasons = resolve(selection.reasonIds, reasonById, REASON_IDS, () => (dropped += 1));
  const whatWouldChange = resolve(
    selection.changeIds,
    changeById,
    CHANGE_IDS,
    () => (dropped += 1),
  );

  // A tier that named reasons but none survived the guard is unusable — fall to the next tier
  // rather than serve a recommendation with no grounded "why".
  if (reasons.length > 0 && keyReasons.length === 0) {
    throw new RiskUnusable(`${selector.source} selected no usable reasons`);
  }

  const action = clampToCeiling(
    VALID_ACTIONS.has(selection.action) ? selection.action : ceilingAction(facts),
    facts,
  );

  // The model may author the one-line rationale in its own words; the prose guard rejects any number
  // it did not ground in the facts or the claim menu, falling back to the bound line. Every other
  // value — the action, the claims, the numbers behind them — stays bound in code.
  const authored =
    selection.rationale === undefined
      ? null
      : guardRationale(selection.rationale, facts, reasons, changes);

  return {
    action,
    actionLabel: ACTION_LABEL[action],
    rationale: authored ?? rationaleLine(facts, action),
    rationaleAuthored: authored !== null,
    keyReasons,
    whatWouldChange,
    alignment: alignmentOf(facts, action),
    alignmentNote: alignmentLine(facts, action),
    refusals: facts.policy.refusals,
    policyAction: facts.policy.action,
    modelAvailable: facts.modelAvailable,
    rehearsal: facts.rehearsal,
    source: selector.source,
    reasoningVersion: REASONING_VERSION,
    groundingHash: hash,
    rationaleClaimIds: keyReasons.map((c) => c.id),
    whatWouldChangeIds: whatWouldChange.map((c) => c.id),
    dropped,
  };
}

/**
 * The prose guard for a model-authored rationale.
 *
 * The model may phrase the one-line rationale itself, but it must not invent a magnitude: every
 * number it writes has to already appear in the grounded facts or the bound claim menu it was given.
 * A single ungrounded number — or an empty, over-long, or multi-line answer — rejects the whole
 * sentence and the caller falls back to the deterministic bound line. Returns the trimmed sentence,
 * or null. This is what lets the model genuinely write the "why" while it still cannot fabricate a
 * count, a card, or a rate.
 */
function guardRationale(
  candidate: string,
  facts: RiskFacts,
  reasons: readonly ProducedClaim[],
  changes: readonly ProducedClaim[],
): string | null {
  const trimmed = candidate.trim();
  if (trimmed === '' || trimmed.length > 240 || /[\r\n]/.test(trimmed)) return null;

  const allowed = new Set<string>();
  allowed.add(String(facts.attempts));
  allowed.add(String(facts.failures));
  if (facts.distinctCards !== null) allowed.add(String(facts.distinctCards));
  allowed.add(String(Math.round(facts.score * 100)));
  if (facts.model !== null) allowed.add(String(Math.round(facts.model.risk * 100)));
  allowed.add('100'); // the universal percentage denominator
  for (const claim of [...reasons, ...changes]) {
    for (const token of numbersIn(claim.text)) allowed.add(token);
  }

  for (const token of numbersIn(trimmed)) {
    if (!allowed.has(token)) return null;
  }
  return trimmed;
}

/** Every numeric token in a string, comma separators stripped (so "1,024" and "1024" compare equal). */
function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((m) => m.replace(/,/g, ''));
}

function resolve(
  ids: readonly string[],
  byId: Map<string, ProducedClaim>,
  known: ReadonlySet<string>,
  onDrop: () => void,
): ProducedClaim[] {
  const out: ProducedClaim[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!known.has(id) || !byId.has(id)) {
      onDrop();
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(byId.get(id)!);
  }
  return out;
}

/** Descend the tiers until one yields a recommendation. The last must be one that cannot fail. */
export async function runRiskFallback(
  facts: RiskFacts,
  selectors: readonly RiskSelector[],
  onSelected?: (assessment: RiskAssessment, selection: RiskSelection) => void,
): Promise<RiskAssessment> {
  let lastError: unknown;
  for (const selector of selectors) {
    try {
      const assessment = await assessWith(facts, selector);
      onSelected?.(assessment, {
        action: assessment.action,
        reasonIds: assessment.rationaleClaimIds,
        changeIds: assessment.whatWouldChangeIds,
        // Record the authored sentence so a later replay reproduces it byte-identically; the bound
        // line is regenerated deterministically, so it needs no recording.
        ...(assessment.rationaleAuthored ? { rationale: assessment.rationale } : {}),
      });
      return assessment;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('no tier yielded a recommendation — the template tier must be present');
}

export type RiskMode = RiskSource;

/** The fallback ladder for a configured mode, mirroring narration's. */
export function riskFallbackChain(
  mode: RiskMode,
  tiers: {
    live?: RiskSelector;
    replay?: RiskSelector;
    local?: RiskSelector;
    template: RiskSelector;
  },
): RiskSelector[] {
  switch (mode) {
    case 'live':
      return [tiers.live, tiers.replay, tiers.local, tiers.template].filter(isSelector);
    case 'replay':
      return [tiers.replay, tiers.template].filter(isSelector);
    case 'local':
      return [tiers.local, tiers.template].filter(isSelector);
    case 'template':
      return [tiers.template];
  }
}

function isSelector(value: RiskSelector | undefined): value is RiskSelector {
  return value !== undefined;
}
