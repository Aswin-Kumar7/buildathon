/**
 * Measures the detector against the whole corpus and writes `METRICS.md`.
 *
 * Run rather than asserted, because the point is the number itself. A test can only say "still
 * within budget"; this says what the budget is being spent on, per scenario, in a file somebody
 * can read without running anything.
 *
 * What counts as a mistake is decided by the scenario's own declared label, which was committed
 * before any of this existed:
 *
 * - a **false positive** is `contain` on a family that is benign or operational — a merchant
 *   stopped from collecting, or customers punished for an acquirer being down;
 * - a **false negative** is an attack family where nothing was contained;
 * - an **abstention** is the detector saying it does not know, which is a legitimate outcome
 *   and is reported rather than hidden inside one of the other two.
 */

import { writeFileSync } from 'node:fs';
import { generate, SCENARIOS, type ScenarioOverrides } from '@sentinel/corpus';
import { computeFeatures, type EntityKind, type Observation } from './features.js';
import { computeTraffic } from './traffic.js';
import { arbitrate, type Decision } from './hypothesis.js';
import { minutes } from './decay.js';
import { thresholdHash, THRESHOLDS } from './thresholds.js';

const WINDOW = { windowMs: minutes(600), halfLifeMs: minutes(5) };
const KINDS: EntityKind[] = ['session', 'device', 'network'];

type Family = Parameters<typeof generate>[0];

function load(family: Family, overrides?: ScenarioOverrides): Observation[] {
  const scenario = generate(family, undefined, overrides);
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

export interface FamilyMetrics {
  family: string;
  classification: string;
  entities: number;
  decisions: Record<Decision, number>;
  best: Record<string, number>;
  abstentions: number;
  falsePositive: boolean;
  falseNegative: boolean;
  /** Correctly explained as an attack, but sent to a person rather than contained. */
  escalated: boolean;
}

export function measure(
  family: Family,
  classification: string,
  overrides?: ScenarioOverrides,
): FamilyMetrics {
  const observations = load(family, overrides);
  const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
  const context = computeTraffic(observations, asOf, WINDOW);

  const decisions: Record<Decision, number> = { contain: 0, review: 0, monitor: 0, none: 0 };
  const best: Record<string, number> = {};
  let entities = 0;
  let abstentions = 0;

  for (const kind of KINDS) {
    const pick = (o: Observation): string | null =>
      kind === 'session'
        ? o.sessionPseudonym
        : kind === 'device'
          ? o.devicePseudonym
          : o.ipPseudonym;

    for (const key of new Set(observations.map(pick))) {
      if (key === null) continue;
      const vector = computeFeatures(kind, key, observations, asOf, WINDOW);
      if (vector.attempts === 0) continue;

      const result = arbitrate(vector, context);
      entities += 1;
      decisions[result.decision] += 1;
      best[result.best] = (best[result.best] ?? 0) + 1;
      if (result.abstained) abstentions += 1;
    }
  }

  const shouldContain = classification === 'attack';
  // Recognised but not acted on is not the same as missed. The distributed attack is explained
  // correctly on every entity and sent to a person, because no single session has enough on its
  // own to justify containment. Calling that a miss would be as misleading as calling it a
  // success.
  const recognised = (best['attack'] ?? 0) > entities / 2;

  return {
    family,
    classification,
    entities,
    decisions,
    best,
    abstentions,
    // Containing anything in a family that is not an attack is the expensive mistake.
    falsePositive: !shouldContain && decisions.contain > 0,
    falseNegative: shouldContain && decisions.contain === 0 && !recognised,
    escalated: shouldContain && decisions.contain === 0 && recognised,
  };
}

const share = (part: number, whole: number): string =>
  whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;

/**
 * A deliberate walk off the edge of what the detector can do.
 *
 * `attack_carding` is the honest family to stress: it has no small-amount tell, so card spread is the
 * only thing separating it from a biller reusing a handful of cards. Re-run it drawing every order
 * from a fixed pool of N cards — wide enumeration at N=64, dunning's shape at N=4 — and containment
 * collapses as the pool narrows into that shape. Reported because a detector that only ever shows its
 * wins is hiding its operating boundary; this is where ours is.
 */
const DRIFT_POOLS = [64, 32, 16, 8, 4] as const;

function driftSlice(): { pool: number; contain: string; recognised: string; verdict: string }[] {
  return DRIFT_POOLS.map((pool) => {
    const m = measure('attack_carding', 'attack', { cardPoolSize: pool });
    const recognisedShare = m.best['attack'] ?? 0;
    return {
      pool,
      contain: share(m.decisions.contain, m.entities),
      recognised: share(recognisedShare, m.entities),
      verdict:
        m.decisions.contain > 0
          ? 'contained'
          : recognisedShare > m.entities / 2
            ? 'recognised, not contained'
            : 'lost in the noise',
    };
  });
}

/** One markdown table row per scenario: its decision split and the verdict that split earns. */
function scenarioRows(all: readonly FamilyMetrics[]): string {
  return all
    .map(
      (m) =>
        `| \`${m.family}\` | ${m.classification} | ${m.entities} | ${m.decisions.contain} | ` +
        `${m.decisions.review} | ${m.decisions.monitor} | ${m.decisions.none} | ` +
        `${share(m.abstentions, m.entities)} | ` +
        `${
          m.falsePositive
            ? '**false positive**'
            : m.falseNegative
              ? '**missed**'
              : m.escalated
                ? 'recognised, escalated'
                : 'correct'
        } |`,
    )
    .join('\n');
}

/** The winning hypothesis per scenario, ordered by how many entities chose it. */
function hypothesisRows(all: readonly FamilyMetrics[]): string {
  return all
    .map(
      (m) =>
        `| \`${m.family}\` | ` +
        Object.entries(m.best)
          .sort((a, b) => b[1] - a[1])
          .map(([h, n]) => `${h} ×${n}`)
          .join(', ') +
        ' |',
    )
    .join('\n');
}

/** The card-pool sweep as markdown rows: containment holding as the pool narrows toward dunning. */
function driftRows(): string {
  return driftSlice()
    .map((d) => `| ${d.pool} | ${d.contain} | ${d.recognised} | ${d.verdict} |`)
    .join('\n');
}

export function report(all: readonly FamilyMetrics[]): string {
  const attacks = all.filter((m) => m.classification === 'attack');
  const benign = all.filter((m) => m.classification !== 'attack');
  const entities = all.reduce((sum, m) => sum + m.entities, 0);
  const abstentions = all.reduce((sum, m) => sum + m.abstentions, 0);

  return `# Metrics

Generated by \`pnpm metrics\` from the committed scenario corpus. Not hand-written, and not
edited afterwards — the numbers are whatever the detector produced on the last run.

Judged by threshold set \`${thresholdHash()}\`, with an arbitration margin of
${THRESHOLDS.arbitrationMargin} and a containment support floor of ${THRESHOLDS.containmentSupport}.

Every entity of every kind — session, device and network — is arbitrated independently, so an
entity appearing under two kinds is counted twice. That inflates the denominators and is the
honest way round: it counts every opportunity the detector had to be wrong.

## Decisions per scenario

A **false positive** is containment on a family that is not an attack: a merchant stopped from
collecting money it is owed, or customers punished for an acquirer being down.

**Recognised, escalated** means the attack was explained correctly on most entities and sent to
a person instead of being contained automatically — which is what happens when no single entity
has enough on its own to justify acting against it. A **miss** is an attack that was not even
explained as one.

| Scenario | Class | Entities | contain | review | monitor | none | Abstained | Verdict |
|---|---|---|---|---|---|---|---|---|
${scenarioRows(all)}

## Winning hypothesis per scenario

| Scenario | Best explanation, by entity count |
|---|---|
${hypothesisRows(all)}

## Totals

- **Entities judged:** ${entities}
- **False positives:** ${benign.filter((m) => m.falsePositive).length} of ${benign.length} non-attack families
- **Attacks contained:** ${attacks.filter((m) => m.decisions.contain > 0).length} of ${attacks.length} attack families
- **Attacks recognised but escalated to a person:** ${attacks.filter((m) => m.escalated).length}
- **Attacks not recognised at all:** ${attacks.filter((m) => m.falseNegative).length}
- **Abstention rate:** ${share(abstentions, entities)} — the detector declining to decide, which
  routes to a person rather than to an action

## Where it degrades — a card-pool sweep

The one axis a card-testing detector lives or dies on is card spread. Here the same carding run is
re-run drawing every order from a fixed pool of N cards instead of a fresh card each time — a wide
enumeration at N=64, narrowing toward the handful of cards a subscription biller reuses in dunning.
Containment holds while the spread is wide and collapses as the pool shrinks into dunning's shape.
That collapse is the honest boundary of what this one signal can separate, printed rather than hidden.

| Cards in pool | Contained | Recognised as attack | Verdict |
|---|---|---|---|
${driftRows()}

## Known blind spots

- **A truly distributed attack opens no rule-based incident.** \`attack_distributed\` above is
  *recognised* as an attack on its entities, but no single session, device or network trips a card-
  spread threshold, so the deterministic rule tier alone would surface nothing to act on. The product
  catches it through a shop-wide fraud-spike pass — a deterministic aggregate that raises one review
  case on the merchant when a cohort of sessions only ever failed across two or more fresh cards, or
  when shop-wide approval has collapsed — which this rule-only harness does not exercise. Because that
  cohort counts only sessions that never approve, a legitimate sale sharing the same window cannot
  dilute it, and a healthy- or merely busy-approval shop with no such cohort is deliberately left
  alone, so a sale is never turned into an alert.
- **The learned model is not measured on this page.** These numbers are the deterministic rule and
  arbitration tier only. The model's held-out precision, recall and calibration live in
  \`ml/models/incident\` and are reported there; the two tiers are combined in the live path, never here.

## What this does not measure

The corpus is synthetic and pre-registered, which makes it honest about tuning and silent about
everything it does not contain. It fixes the card issuer at one value, so issuer breadth is
reported and never depended on. It is one merchant, so an attacker distributing across hundreds
of them is outside what any of these numbers describe.
`;
}

/** Written to the repository root, beside the README a reader would look at first. */
export function writeReport(path = 'METRICS.md'): FamilyMetrics[] {
  // SCENARIOS is keyed by family, so the family name is the key rather than a field.
  const all = Object.entries(SCENARIOS).map(([family, spec]) =>
    measure(family as Family, spec.classification),
  );
  writeFileSync(path, report(all), 'utf8');
  return all;
}
