/**
 * The invariant the API's incident de-escalation rests on.
 *
 * Early card-testing and a biller's dunning are feature-identical in a burst window — the same
 * eight cards, seen once each, failing — so the detector correctly opens an incident on both, and a
 * static threshold cannot separate them without blinding it to real attacks (proven by streaming
 * both through the live window: they open at an identical `cards=8, attempts=8`). The separation is
 * temporal: given more attempts, the biller reuses its few cards and the arbitration flips to a
 * positive benign explanation, while an attack keeps introducing new cards and never does.
 *
 * The service keys its de-escalation on exactly that — {@link arbitrationExplainsBenign} — so these
 * two guarantees are what make it safe and effective:
 *
 *   1. a real attack NEVER re-explains itself benign (so de-escalation can never resolve one), and
 *   2. a streaming dunning run DOES, on the entities whose reuse becomes visible (so the false
 *      positives it opens are actually stood down).
 *
 * Both are asserted here, at the detect layer, so a change to the arbitration that broke either
 * would fail loudly rather than surface as a mislabelled incident in production.
 */

import { describe, expect, it } from 'vitest';
import { generate, type ScenarioFamily, type ScenarioOverrides } from '@sentinel/corpus';
import {
  computeAllFeatures,
  DEFAULT_WINDOW,
  type EntityKind,
  type Observation,
} from './features.js';
import { evaluateRules } from './rules.js';
import { arbitrate } from './hypothesis.js';
import { arbitrationExplainsBenign } from './decision.js';
import { computeTraffic } from './traffic.js';

function toObservations(
  family: ScenarioFamily,
  seed: number,
  overrides?: ScenarioOverrides,
): Observation[] {
  const scenario = generate(family, seed, { realisticMethods: true, ...overrides });
  const checkouts = new Map(scenario.checkouts.map((c) => [c.razorpayOrderId, c]));
  return scenario.events.flatMap((event): Observation[] => {
    const body = event.body as {
      created_at: number;
      payload?: { payment?: { entity?: Record<string, unknown> } };
    };
    const entity = body.payload?.payment?.entity;
    if (entity === undefined) return [];
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const orderId = str(entity['order_id']) ?? '';
    const checkout = checkouts.get(orderId);
    const status = str(entity['status']);
    return [
      {
        at: body.created_at * 1000,
        razorpayOrderId: orderId,
        razorpayPaymentId: str(entity['id']) ?? '',
        outcome:
          status === 'captured'
            ? 'captured'
            : status === 'failed'
              ? 'failed'
              : status === 'authorized'
                ? 'authorized'
                : 'other',
        amountPaise: typeof entity['amount'] === 'number' ? entity['amount'] : null,
        cardId: str(entity['card_id']),
        errorSource: str(entity['error_source']),
        errorReason: str(entity['error_reason']),
        sessionPseudonym: checkout ? `v1:${checkout.clientSessionId}` : null,
        devicePseudonym: checkout ? `v1:${checkout.deviceId}` : null,
        ipPseudonym: checkout ? `v1:${checkout.ip}` : null,
        userAgentFamily: checkout?.userAgentFamily ?? null,
      },
    ];
  });
}

const KINDS: EntityKind[] = ['session', 'device', 'network'];

/** One evaluation checkpoint: records which entities have opened (card_spread) and which went benign. */
function scanAt(
  obs: Observation[],
  asOf: number,
  hasOpened: Set<string>,
  wentBenign: Set<string>,
): void {
  const traffic = computeTraffic(obs, asOf, DEFAULT_WINDOW);
  for (const kind of KINDS) {
    for (const vector of computeAllFeatures(kind, obs, asOf, DEFAULT_WINDOW)) {
      const id = `${kind}:${vector.entityKey}`;
      if (evaluateRules(vector).some((o) => o.rule === 'card_spread' && o.fired)) hasOpened.add(id);
      // A benign re-explanation only counts once the incident exists — that is what gets closed.
      if (hasOpened.has(id) && arbitrationExplainsBenign(arbitrate(vector, traffic).best)) {
        wentBenign.add(id);
      }
    }
  }
}

/**
 * Streams a scenario checkpoint by checkpoint, exactly as the live pipeline re-evaluates it, and
 * reports how many entities open an incident (trip `card_spread`) and how many later re-explain
 * themselves benign on a subsequent checkpoint — which is the moment the service de-escalates them.
 */
function streamOutcomes(
  family: ScenarioFamily,
  seeds: number[],
  overrides?: ScenarioOverrides,
): {
  opened: number;
  reExplainedBenign: number;
} {
  let opened = 0;
  let reExplainedBenign = 0;

  for (const seed of seeds) {
    const obs = toObservations(family, seed, overrides);
    const times = [...new Set(obs.map((o) => o.at))].sort((a, b) => a - b);
    const hasOpened = new Set<string>();
    const wentBenign = new Set<string>();

    for (const asOf of times) {
      scanAt(obs, asOf, hasOpened, wentBenign);
    }
    opened += hasOpened.size;
    reExplainedBenign += wentBenign.size;
  }
  return { opened, reExplainedBenign };
}

const SEEDS = [5100, 5200, 5300, 5400, 5500, 5600, 5700, 5800];

describe('incident de-escalation invariant', () => {
  it('a real attack never re-explains itself benign — de-escalation can never resolve one', () => {
    const loud = streamOutcomes('attack_loud', SEEDS);
    const distributed = streamOutcomes('attack_loud', SEEDS, { distinctSessions: [16, 22] });

    expect(loud.opened).toBeGreaterThan(0);
    expect(distributed.opened).toBeGreaterThan(0);
    // The safety guarantee: not a single opened attack entity ever arbitrates to a benign cause.
    expect(loud.reExplainedBenign).toBe(0);
    expect(distributed.reExplainedBenign).toBe(0);
    // Streams two full scenarios through the pipeline at every checkpoint across eight seeds — several
    // seconds of real work, so a generous timeout keeps a loaded CI runner from failing it on the clock
    // rather than on the invariant it actually asserts.
  }, 30_000);

  it('streaming dunning opens incidents that later re-explain themselves benign', () => {
    const dunning = streamOutcomes('retry_storm', SEEDS);

    // The burst gate opens on legitimate dunning (the false positive this exists to handle)…
    expect(dunning.opened).toBeGreaterThan(0);
    // …and the entities whose reuse becomes visible flip to a benign explanation, which is what the
    // service de-escalates on. Not necessarily all of them: a slice showing eight cards once each and
    // never any reuse stays genuinely indistinguishable from an eight-card attack, and is left for a person.
    expect(dunning.reExplainedBenign).toBeGreaterThan(0);
  }, 30_000);
});
