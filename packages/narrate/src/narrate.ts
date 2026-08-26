/**
 * The fact guard and the fallback ladder — where selection, guarding, rendering and degradation meet.
 *
 * A selector returns claim ids. Before any of them becomes a sentence they pass the guard, which is
 * the one thing standing between a model and a reader: an id that is not in the catalog is a
 * hallucinated claim and is dropped; an id whose claim does not apply to these facts is unresolvable
 * and is dropped; the number that were dropped is returned as a signal, because a narrator that keeps
 * naming claims that do not exist is a narrator going wrong and that has to be measurable, not
 * invisible.
 *
 * The ladder tries tiers in order and takes the first that yields a usable narrative, with the
 * template at the bottom because it cannot fail. The design goal it serves is exact: when the live
 * provider goes away, replay reproduces the same selection from its recording, so the narrative a
 * reader sees does not change — only the badge that says where it came from does.
 */

import { availableClaims, type NarrationSource, type Selector } from './select.js';
import { CLAIM_IDS } from './catalog.js';
import { evidenceHash, type NarrationFacts } from './facts.js';

export interface NarrativeLine {
  claimId: string;
  text: string;
  source: NarrationSource;
  /** The evidence codes / fact keys this line's values were bound from. */
  evidence: string[];
}

export interface Narrative {
  lines: NarrativeLine[];
  /** The tier that chose these claims — the badge. */
  source: NarrationSource;
  /** How many chosen claim ids the guard dropped: the hallucination signal for this narrative. */
  dropped: number;
  evidenceHash: string;
}

/** Raised when a tier produced nothing usable from a non-empty set of claims, so the ladder descends. */
export class NarrationUnusable extends Error {}

/**
 * Run one tier: select, guard, render. Throws {@link NarrationUnusable} when claims were available
 * but the selector named none that survived the guard — a signal to fall to the next tier, not an
 * empty narrative to serve.
 */
export async function narrateWith(facts: NarrationFacts, selector: Selector): Promise<Narrative> {
  const hash = evidenceHash(facts);
  const available = availableClaims(facts);
  const byId = new Map(available.map((entry) => [entry.id, entry]));
  const availableIds = available.map((entry) => entry.id);

  const chosen = await selector.select(facts, availableIds, hash);

  const lines: NarrativeLine[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const id of chosen) {
    // Unknown to the catalog, or known but not applicable here: both are the guard doing its job.
    if (!CLAIM_IDS.has(id) || !byId.has(id)) {
      dropped += 1;
      continue;
    }
    if (seen.has(id)) continue; // a repeat is not a hallucination, just deduplicated
    seen.add(id);
    const entry = byId.get(id)!;
    lines.push({
      claimId: id,
      text: entry.text,
      source: selector.source,
      evidence: entry.evidence,
    });
  }

  if (availableIds.length > 0 && lines.length === 0) {
    throw new NarrationUnusable(`${selector.source} selected nothing usable`);
  }

  return { lines, source: selector.source, dropped, evidenceHash: hash };
}

/**
 * Descend the tiers until one yields a narrative. The last selector must be one that cannot fail
 * (the template), so this always resolves. `onSelected` fires for the tier that won, so a live run
 * can be recorded for later replay.
 */
export async function runFallback(
  facts: NarrationFacts,
  selectors: readonly Selector[],
  onSelected?: (narrative: Narrative) => void,
): Promise<Narrative> {
  let lastError: unknown;
  for (const selector of selectors) {
    try {
      const narrative = await narrateWith(facts, selector);
      onSelected?.(narrative);
      return narrative;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('no selector yielded a narrative — the template tier must be present');
}

export type NarrationMode = NarrationSource;

/**
 * The fallback ladder for a configured mode. Live descends through replay first, so a recorded run is
 * reproduced verbatim before anything re-selects and the content shifts; only then local, then the
 * template floor. The lower modes are deliberate choices and fall straight to the floor.
 */
export function fallbackChain(
  mode: NarrationMode,
  tiers: { live?: Selector; replay?: Selector; local?: Selector; template: Selector },
): Selector[] {
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

function isSelector(value: Selector | undefined): value is Selector {
  return value !== undefined;
}
