/**
 * Composing scenarios into one shop.
 *
 * The eight committed families are each generated in isolation, and a model trained on them
 * separates them perfectly — because an isolated scenario's *traffic context* encodes its family
 * exactly. An outage scenario's shop is all outage; an attack scenario's shop is all attack. The
 * population signal a detector leans on is, in that corpus, a giveaway rather than a clue.
 *
 * Real card testing does not arrive in an empty shop. It hides inside ordinary checkout traffic,
 * and every honest shopper around it dilutes the population signal. `mix` reproduces that: it
 * overlays scenarios — one or more benign backgrounds and one or more embedded attacks — into a
 * single event stream, and records which entities belong to an attack so the training exporter can
 * label them. The features are then computed over the *combined* shop, which is where the honest
 * difficulty comes from. A masked attacker no longer sits in a shop that screams "attack"; an
 * outage no longer sits in a shop that screams "outage" with nothing hiding inside it.
 *
 * Sessions carry collision-free identifiers, so an entity's origin is unambiguous after the merge.
 * Networks are deliberately *not* labelled from a mix: the synthetic address range is small and
 * shared across families (RFC 5737's /24), so a merged IP could legitimately carry both benign and
 * attack traffic. The distributed, network-level attack is covered by its own standalone family,
 * where the addresses mean what they say.
 */

import { generate } from './generate.js';
import type { GeneratedCheckout, GeneratedEvent, ScenarioOverrides } from './generate.js';
import type { ScenarioFamily } from './spec.js';

export interface MixPart {
  family: ScenarioFamily;
  seed: number;
  /** `attack` parts contribute the positive (abuse) entities; `background` parts are all benign. */
  role: 'background' | 'attack';
  /**
   * Range overrides for this part, so an embedded attack can be *evasive* — reusing cards, taking
   * partial approvals — not just a full-strength burst dropped into a crowd. A sophisticated attacker
   * blends in on every axis at once, and that is the case a masked composition should actually pose.
   */
  overrides?: ScenarioOverrides;
}

export interface Mixed {
  checkouts: GeneratedCheckout[];
  events: GeneratedEvent[];
  /** Raw session identifiers belonging to an embedded attack. Every other session is benign. */
  abuseSessionIds: Set<string>;
  /** Raw device identifiers belonging to an embedded attack, for the device-level view. */
  abuseDeviceIds: Set<string>;
  parts: readonly MixPart[];
}

/**
 * Overlays scenarios into one shop, tracking which sessions the attacks own.
 *
 * Every part is generated from its own family and seed, so their identifiers do not collide and the
 * merge is just concatenation — no timestamp surgery. All parts share the generator's fixed epoch,
 * and the exporter's window is wide enough to hold the whole composed shop, so every entity is seen
 * against the same combined traffic context, which is the entire point.
 */
export function mix(parts: readonly MixPart[]): Mixed {
  // Two parts on the same seed produce the *same* identifiers — regardless of family. The generator
  // makes a fixed number of draws before the session ids, and the seeded stream advances by state
  // alone, so id('sess') lands at the same position with the same value for any family sharing a
  // seed. A background would then share sessions with an attack and be mislabelled. Distinct seeds
  // per part is the caller's contract; enforce it, because a silent label leak is the worst kind.
  const seeds = parts.map((p) => p.seed);
  if (new Set(seeds).size !== seeds.length) {
    throw new Error(`mix: parts must use distinct seeds; got ${seeds.join(', ')}`);
  }

  const checkouts: GeneratedCheckout[] = [];
  const events: GeneratedEvent[] = [];
  const abuseSessionIds = new Set<string>();
  const abuseDeviceIds = new Set<string>();

  for (const part of parts) {
    const scenario = generate(part.family, part.seed, part.overrides);
    checkouts.push(...scenario.checkouts);
    events.push(...scenario.events);

    if (part.role === 'attack') {
      for (const checkout of scenario.checkouts) {
        abuseSessionIds.add(checkout.clientSessionId);
        abuseDeviceIds.add(checkout.deviceId);
      }
    }
  }

  return { checkouts, events, abuseSessionIds, abuseDeviceIds, parts };
}
