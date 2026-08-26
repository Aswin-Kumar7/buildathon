// Emits the abuse-risk model's training table from the scenario corpus.
//
// Features are computed here, once, by the same @sentinel/detect functions the API uses at scoring
// time — so the model trains on exactly the numbers it will later be asked to score. Deterministic:
// the corpus is seeded, and this walks a fixed range of seeds, so training.csv is reproducible and
// its hash is what the model registry pins.
//
// The label is binary: `is_abuse` is 1 for an entity that belongs to a card-testing / enumeration
// attack, 0 for everything else — an outage, a biller's dunning, a mistyped card, an ordinary
// shopper. The model learns a single risk score P(abuse); the deterministic arbitration keeps the
// job of saying *which* benign thing a low-risk entity is. That split is the whole redesign: one
// deployed number, honestly measured, feeding rules → policy → audit.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generate, mix } from '@sentinel/corpus';
import {
  computeFeatures,
  computeTraffic,
  incidentFeatures,
  INCIDENT_FEATURE_NAMES,
  minutes,
} from '@sentinel/detect';

const HERE = dirname(fileURLToPath(import.meta.url));
const WINDOW = { windowMs: minutes(600), halfLifeMs: minutes(5) };
const SEEDS = 40;

// Which standalone families are abuse. These are the eight committed scenarios, each generated in
// isolation — the easy end of the distribution, where the whole shop is one thing. The hard end,
// where an attack hides inside real traffic, comes from the compositions below.
const FAMILY_ABUSE = {
  attack_loud: 1,
  attack_distributed: 1,
  attack_low_amplitude: 1,
  gateway_outage: 0,
  retry_storm: 0,
  normal_traffic: 0,
  flash_sale: 0,
  customer_error: 0,
};

// The hard cases: an attack overlaid on a benign background, so the population signal is diluted by
// honest shoppers and the model cannot lean on "the whole shop is failing". Each entry is one shop;
// the attack's sessions are the positives, everything else in that shop is a negative measured in
// the same diluted traffic context. Seeds are assigned disjointly (below) so no underlying scenario
// is ever shared between two split groups.
// The embedded attacks are *evasive*: a small card pool, some approvals, ordinary amounts — so a
// masked attacker is ambiguous per-entity as well as diluted in the traffic, which is what a real
// one does. A full-strength burst dropped into a crowd is still betrayed by its own signature; this
// is the harder, more honest case.
const evasive = (b) => ({
  cardPoolSize: 8 + (b % 22),
  approvalRate: [0.05, 0.2],
  amountPaise: [8_000, 80_000],
});

const COMPOSITIONS = [
  // A patient attack hidden in an ordinary hour — the needle-in-haystack case, where the traffic
  // context is almost entirely benign and the attacker has muted its own per-entity signature.
  (b) => ({
    origin: 'masked_slow_in_normal',
    parts: [
      { family: 'normal_traffic', seed: b + 1, role: 'background' },
      { family: 'normal_traffic', seed: b + 2, role: 'background' },
      { family: 'attack_low_amplitude', seed: b + 3, role: 'attack', overrides: evasive(b) },
    ],
  }),
  // An evasive run during a sale: the shop is legitimately busy and failing some, so volume and
  // failure count no longer single the attacker out.
  (b) => ({
    origin: 'masked_loud_in_flash',
    parts: [
      { family: 'flash_sale', seed: b + 1, role: 'background' },
      { family: 'attack_loud', seed: b + 2, role: 'attack', overrides: evasive(b) },
    ],
  }),
  // An attack hiding behind an outage: the population signal says "gateway is down, do nothing",
  // and a model that over-trusts the traffic features will miss the attacker embedded in it.
  (b) => ({
    origin: 'masked_in_outage',
    parts: [
      { family: 'gateway_outage', seed: b + 1, role: 'background' },
      { family: 'attack_low_amplitude', seed: b + 2, role: 'attack', overrides: evasive(b) },
    ],
  }),
  // An evasive attack amid a biller's dunning and ordinary traffic — two different benign failure
  // sources around it, so failure rate alone is uninformative.
  (b) => ({
    origin: 'masked_loud_in_dunning',
    parts: [
      { family: 'normal_traffic', seed: b + 1, role: 'background' },
      { family: 'retry_storm', seed: b + 2, role: 'background' },
      { family: 'attack_loud', seed: b + 3, role: 'attack', overrides: evasive(b) },
    ],
  }),
];

// Boundary cases: entities that sit *across* the class line on an axis that otherwise separates it
// cleanly. Card testing and a biller's dunning differ mainly in card spread — so here an attack
// reuses a small pool (dunning-shaped) and a benign batch walks many cards (enumeration-shaped);
// an attack takes real approvals (benign-shaped) and a broken checkout fails hard (attack-shaped).
// Each is one standalone shop generated with overridden ranges. Without these the classes never
// overlap and the model separates them perfectly — a score that measures the corpus, not the task.
const BOUNDARY = [
  // Abuse wearing a benign shape:
  // A tester working a pool of stolen cards. It overlaps the aggressive-dunning benign below in the
  // middle — but a tester walks a *wider* pool at *smaller*, more varied amounts than a biller
  // retrying the same handful of real subscriptions, so each axis separates partly and none cleanly.
  (s) => ({
    origin: 'attack_card_reuse',
    isAbuse: 1,
    family: 'attack_low_amplitude',
    overrides: {
      cardPoolSize: 12 + (s % 28),
      approvalRate: [0.02, 0.14],
      amountPaise: [8_000, 60_000],
      orders: [45, 95],
      distinctSessions: [1, 3],
    },
  }),
  // A patient attacker finding live cards at real amounts — a real fraction approve and the amounts
  // are ordinary, so only the absence of recovery and the wider card walk separate it from a broken
  // checkout. Blurs the approval and amount axes at once.
  (s) => ({
    origin: 'attack_partial_success',
    isAbuse: 1,
    family: 'attack_low_amplitude',
    overrides: {
      approvalRate: [0.14, 0.34],
      amountPaise: [8_000, 90_000],
      distinctSessions: [1, 3],
      orders: [40, 85],
    },
  }),
  // Benign wearing an attack shape:
  // A big renewal batch, low approval — but a biller retries a *tight* set of real subscriptions at
  // *consistent, larger* amounts. It overlaps the tester above in the middle and separates at the
  // edges (tighter card pool, bigger amounts, slightly higher approval).
  (s) => ({
    origin: 'aggressive_dunning',
    isAbuse: 0,
    family: 'retry_storm',
    overrides: {
      cardPoolSize: 5 + (s % 16),
      distinctSessions: [1, 3],
      orders: [45, 95],
      approvalRate: [0.06, 0.2],
      amountPaise: [25_000, 99_900],
    },
  }),
  // A broken checkout integration: many shoppers' cards funnelled through a couple of sessions,
  // failing hard for a while and then recovering — the same box as attack_partial_success, benign
  // by its recovery.
  (s) => ({
    origin: 'broken_integration',
    isAbuse: 0,
    family: 'customer_error',
    overrides: {
      distinctSessions: [1, 3],
      orders: [40, 85],
      approvalRate: [0.16, 0.36],
      amountPaise: [8_000, 90_000],
    },
  }),
];

// The feature definition and its builder are shared with the API via @sentinel/detect, so the
// model trains on exactly the numbers the request path will later score.
const FEATURES = [...INCIDENT_FEATURE_NAMES];

// The network identity the API actually keys on: the /24 subnet, not the full address — so a burst
// of attempts from one network is one entity even as the last octet rotates. The exporter must key
// networks the same way, or the model would train on thin per-address entities and then be served
// fat per-subnet ones (a whole busy shop as a single network), which reads as attack-shaped volume.
function networkOf(ip) {
  const octets = ip.split('.');
  return octets.length === 4 ? `${octets.slice(0, 3).join('.')}.0/24` : 'unknown';
}

function observationsFrom(scenario) {
  const checkouts = new Map(scenario.checkouts.map((c) => [c.razorpayOrderId, c]));
  return scenario.events.flatMap((event) => {
    const entity = event.body?.payload?.payment?.entity;
    if (entity === undefined) return [];
    const checkout = checkouts.get(entity.order_id);
    const status = String(entity.status ?? '');
    return [
      {
        at: event.body.created_at * 1000,
        razorpayOrderId: String(entity.order_id ?? ''),
        razorpayPaymentId: String(entity.id ?? ''),
        outcome:
          status === 'captured'
            ? 'captured'
            : status === 'failed'
              ? 'failed'
              : status === 'authorized'
                ? 'authorized'
                : 'other',
        amountPaise: typeof entity.amount === 'number' ? entity.amount : null,
        cardId: typeof entity.card_id === 'string' ? entity.card_id : null,
        errorSource: typeof entity.error_source === 'string' ? entity.error_source : null,
        errorReason: typeof entity.error_reason === 'string' ? entity.error_reason : null,
        sessionPseudonym: checkout ? `v1:${checkout.clientSessionId}` : null,
        devicePseudonym: checkout ? `v1:${checkout.deviceId}` : null,
        ipPseudonym: checkout ? `v1:${networkOf(checkout.ip)}` : null,
        userAgentFamily: checkout?.userAgentFamily ?? null,
      },
    ];
  });
}

function featureRow(vector, traffic) {
  const values = incidentFeatures(vector, traffic);
  return Object.fromEntries(FEATURES.map((name, i) => [name, values[i]]));
}

const rows = [];

// Standalone families: the whole shop is one thing, so every sampled entity carries the family's
// label. Both the session and network views are emitted — the network view is where the distributed
// attack lives, and it is generated in isolation here so its addresses mean what they say.
for (let seed = 0; seed < SEEDS; seed += 1) {
  for (const [family, isAbuse] of Object.entries(FAMILY_ABUSE)) {
    const scenario = generate(family, seed + 1);
    const observations = observationsFrom(scenario);
    if (observations.length === 0) continue;
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const traffic = computeTraffic(observations, asOf, WINDOW);

    // The standalone attacks are the trivially-separable floor — the whole shop is on fire. A few
    // per shop are enough to keep them represented; over-sampling them would let easy positives
    // dominate the metric and flatter it. Benign shops are sampled wider: their hardest entities
    // (the ones failing most) are the false positives worth measuring.
    const cap = isAbuse ? 4 : 8;
    for (const kind of ['session', 'network']) {
      const pick = (o) => (kind === 'session' ? o.sessionPseudonym : o.ipPseudonym);
      const keys = [...new Set(observations.map(pick))].filter((k) => k !== null);
      const vectors = keys
        .map((key) => computeFeatures(kind, key, observations, asOf, WINDOW, true))
        .filter((v) => v.attempts > 0)
        .sort((a, b) => b.failures - a.failures || b.attempts - a.attempts)
        .slice(0, cap);

      for (const vector of vectors) {
        rows.push({
          ...featureRow(vector, traffic),
          is_abuse: isAbuse,
          group: `${family}_${seed}`,
          origin: family,
        });
      }
    }
  }
}

// Composed shops: an attack embedded in a benign background. The traffic context is computed over
// the whole merged shop — diluted — and each session is labelled by whether it belongs to the
// attack. Session view only: the synthetic address range is shared across families, so a merged IP
// is not a clean network identity; the standalone attack_distributed family covers the network case.
for (let seed = 1; seed <= SEEDS; seed += 1) {
  for (let ci = 0; ci < COMPOSITIONS.length; ci += 1) {
    // Disjoint from the standalone seeds (1..SEEDS) and unique per (composition, seed, part), so no
    // generated scenario is ever shared between two split groups — which would leak across the split.
    const base = 10_000 + ci * 1_000 + seed * 10;
    const { origin, parts } = COMPOSITIONS[ci](base);
    const merged = mix(parts);
    const observations = observationsFrom({ checkouts: merged.checkouts, events: merged.events });
    if (observations.length === 0) continue;
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const traffic = computeTraffic(observations, asOf, WINDOW);

    const abusePseudonyms = new Set([...merged.abuseSessionIds].map((id) => `v1:${id}`));
    const keys = [...new Set(observations.map((o) => o.sessionPseudonym))].filter(
      (k) => k !== null,
    );
    const vectors = keys
      .map((key) => computeFeatures('session', key, observations, asOf, WINDOW, true))
      .filter((v) => v.attempts > 0);

    const abuse = vectors.filter((v) => abusePseudonyms.has(v.entityKey));
    // The hard negatives: benign sessions that failed the most in this diluted shop. A model that
    // reaches for failure volume trips on exactly these, which is why they belong in the test set.
    const benign = vectors
      .filter((v) => !abusePseudonyms.has(v.entityKey))
      .sort((a, b) => b.failures - a.failures || b.attempts - a.attempts)
      .slice(0, Math.max(15, abuse.length * 3));

    for (const vector of [...abuse, ...benign]) {
      const isAbuse = abusePseudonyms.has(vector.entityKey);
      rows.push({
        ...featureRow(vector, traffic),
        is_abuse: isAbuse ? 1 : 0,
        group: `${origin}_${seed}`,
        // The attack sessions carry the composition's name; the benign shoppers around them carry a
        // `_background` origin, so the per-origin breakdown reports each label purely rather than
        // hiding the hard negatives under an "attack" heading.
        origin: isAbuse ? origin : `${origin}_background`,
      });
    }
  }
}

// Boundary shops: one standalone scenario per variant, generated with overridden ranges so it lands
// in the overlap zone. Seeds are disjoint from every other block, so no scenario is shared across a
// split group. Both entity views are emitted; a standalone shop's addresses are its own, so the
// network view is clean here.
for (let seed = 1; seed <= SEEDS; seed += 1) {
  for (let vi = 0; vi < BOUNDARY.length; vi += 1) {
    const { origin, isAbuse, family, overrides } = BOUNDARY[vi](seed);
    const scenario = generate(family, 30_000 + vi * 1_000 + seed, overrides);
    const observations = observationsFrom(scenario);
    if (observations.length === 0) continue;
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const traffic = computeTraffic(observations, asOf, WINDOW);

    for (const kind of ['session', 'network']) {
      const pick = (o) => (kind === 'session' ? o.sessionPseudonym : o.ipPseudonym);
      const keys = [...new Set(observations.map(pick))].filter((k) => k !== null);
      const vectors = keys
        .map((key) => computeFeatures(kind, key, observations, asOf, WINDOW, true))
        .filter((v) => v.attempts > 0)
        .sort((a, b) => b.failures - a.failures || b.attempts - a.attempts)
        .slice(0, 8);

      for (const vector of vectors) {
        rows.push({
          ...featureRow(vector, traffic),
          is_abuse: isAbuse,
          group: `${origin}_${seed}`,
          origin,
        });
      }
    }
  }
}

mkdirSync(join(HERE, 'data'), { recursive: true });
const header = [...FEATURES, 'is_abuse', 'group', 'origin'];
const lines = [header.join(',')];
for (const row of rows) {
  lines.push(
    header
      .map((col) => (typeof row[col] === 'number' ? Number(row[col].toFixed(6)) : row[col]))
      .join(','),
  );
}
writeFileSync(join(HERE, 'data', 'training.csv'), lines.join('\n') + '\n', 'utf8');

const positives = rows.filter((r) => r.is_abuse === 1).length;
console.log(
  `export — ${rows.length} rows (${positives} abuse, ${rows.length - positives} benign), ` +
    `${SEEDS} seeds, ${Object.keys(FAMILY_ABUSE).length} standalone families + ` +
    `${COMPOSITIONS.length} compositions`,
);
