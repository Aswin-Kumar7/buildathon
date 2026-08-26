/**
 * The four tiers a narrative's *selection* can come from — and only the selection. Every tier hands
 * back an ordered list of claim ids drawn from the ones that apply; the wording and the numbers are
 * bound elsewhere and are identical whichever tier chose. That is the property the degradation ladder
 * rests on: dropping from one tier to the next changes which claims are made and the badge that says
 * so, never a single value a reader sees.
 *
 *   live     → a remote provider (an LLM) proposes an ordering. The only tier that can fail.
 *   local    → an on-device heuristic. Deterministic, always available, no network.
 *   replay   → a recorded live selection, reproduced byte-identically offline.
 *   template → the catalog's own order. The floor: it cannot fail and needs nothing.
 */

import { CATALOG, type Claim } from './catalog.js';
import type { NarrationFacts } from './facts.js';

export type NarrationSource = 'live' | 'local' | 'replay' | 'template';

export interface Selector {
  readonly source: NarrationSource;
  /**
   * Choose an ordered list of claim ids from those available. Async so a provider can be one, and
   * given the evidence hash so a replay can find its recording. A selector that cannot answer throws,
   * and the caller falls to the next tier.
   */
  select(
    facts: NarrationFacts,
    available: readonly string[],
    evidenceHash: string,
  ): Promise<string[]> | string[];
}

/** A remote narrator: proposes an ordering, and may be slow, wrong, or unreachable. */
export interface NarrationProvider {
  propose(facts: NarrationFacts, available: readonly string[]): Promise<string[]>;
}

/** A record of what a live narrator once chose for a given evidence hash, so it can be replayed. */
export interface ReplayStore {
  get(evidenceHash: string): string[] | undefined;
  put(evidenceHash: string, claimIds: string[]): void;
}

/**
 * The catalog's declaration order: headline, the evidence, the change signal, the model, the
 * decision. Needs no model and cannot fail, so it is both a tier and the fallback under every other.
 */
export const templateSelector: Selector = {
  source: 'template',
  select: (_facts, available) => [...available],
};

/**
 * The on-device tier: a fixed, deterministic priority that writes a tighter account than the full
 * template — lead with the call, give the two strongest reasons and any counter-evidence, note the
 * model, end on the decision. It stands in for a local model: no network, same every time.
 */
export const localSelector: Selector = {
  source: 'local',
  select: (_facts, available) => {
    const priority = [
      'headline',
      'top_reason',
      'supporting_reason',
      'mitigating',
      'model_opinion',
      'change_signal',
      'decision',
    ];
    const present = new Set(available);
    return priority.filter((id) => present.has(id));
  },
};

/** The live tier, wrapping a provider. The only selector that awaits the network. */
export function liveSelector(provider: NarrationProvider): Selector {
  return {
    source: 'live',
    select: (facts, available) => provider.propose(facts, available),
  };
}

/**
 * The replay tier: serve the exact ordering a live narrator once produced for this evidence. Throws
 * when nothing was recorded, so the caller falls through to the template — replay reproduces a past
 * live run, it does not invent one.
 */
export function replaySelector(store: ReplayStore): Selector {
  return {
    source: 'replay',
    select: (_facts, _available, evidenceHash) => {
      const recorded = store.get(evidenceHash);
      if (recorded === undefined) throw new Error(`no recorded narrative for ${evidenceHash}`);
      return recorded;
    },
  };
}

/** The claims that apply to these facts, in catalog order, each already bound and rendered. */
export function availableClaims(
  facts: NarrationFacts,
): { id: string; claim: Claim; text: string; evidence: string[] }[] {
  const out: { id: string; claim: Claim; text: string; evidence: string[] }[] = [];
  for (const claim of CATALOG) {
    const produced = claim.produce(facts);
    if (produced !== null)
      out.push({ id: claim.id, claim, text: produced.text, evidence: produced.evidence });
  }
  return out;
}
