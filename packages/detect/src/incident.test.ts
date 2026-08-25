import { describe, expect, it } from 'vitest';
import { computeFeatures, type FeatureVector, type Observation } from './features.js';
import { evaluateRules } from './rules.js';
import { scoreOutcomes } from './score.js';
import { minutes } from './decay.js';
import { THRESHOLDS } from './thresholds.js';
import {
  belongsTo,
  canTransition,
  clusterIncidents,
  dropDuplicateViews,
  expireIfIdle,
  firedRules,
  foldInto,
  InvalidTransition,
  openIncident,
  timeToDetect,
  transition,
  warrantsIncident,
  type Evaluation,
  type IncidentStatus,
} from './incident.js';
import { generate } from '@sentinel/corpus';

const T0 = Date.parse('2026-03-01T09:00:00.000Z');
const WIDE = { windowMs: minutes(600), halfLifeMs: minutes(5) };

function observation(overrides: Partial<Observation> = {}): Observation {
  const merged: Observation = {
    at: T0,
    razorpayOrderId: 'order_1',
    razorpayPaymentId: 'pay_1',
    outcome: 'failed',
    amountPaise: 100,
    cardId: 'card_1',
    errorSource: 'bank',
    errorReason: 'invalid_card',
    sessionPseudonym: 'v1:session-a',
    devicePseudonym: 'v1:device-a',
    ipPseudonym: 'v1:network-a',
    userAgentFamily: 'chrome',
    ...overrides,
  };

  // A distinct payment per attempt unless a test says otherwise. Sharing an id now means "the
  // same payment, seen again through another webhook", which is not what these fixtures mean —
  // and left at a constant it collapsed forty attempts into one.
  return {
    ...merged,
    razorpayPaymentId: overrides.razorpayPaymentId ?? `pay_${merged.sessionPseudonym}_${merged.at}`,
  };
}

/** One session walking a card list, starting at `from`. */
function enumeration(count = 30, from = T0): Observation[] {
  return Array.from({ length: count }, (_, i) =>
    observation({
      at: from + i * 10_000,
      razorpayOrderId: `order_${from}_${i}`,
      razorpayPaymentId: `pay_${from}_${i}`,
      cardId: `card_${from}_${i}`,
    }),
  );
}

function vectorFor(observations: readonly Observation[], asOf?: number): FeatureVector {
  const at = asOf ?? Math.max(...observations.map((o) => o.at)) + 1000;
  return computeFeatures('session', 'v1:session-a', observations, at, WIDE);
}

function evaluationFor(observations: readonly Observation[], asOf?: number): Evaluation {
  const at = asOf ?? Math.max(...observations.map((o) => o.at)) + 1000;
  const vector = vectorFor(observations, at);
  return { vector, outcomes: evaluateRules(vector), at };
}

describe('opening an incident', () => {
  it('only opens above the floor', () => {
    const shopper = [
      observation({ at: T0, razorpayOrderId: 'order_1' }),
      observation({ at: T0 + 40_000, razorpayOrderId: 'order_1', outcome: 'captured' }),
    ];

    expect(warrantsIncident(scoreOutcomes(evaluateRules(vectorFor(shopper))))).toBe(false);
    expect(warrantsIncident(scoreOutcomes(evaluateRules(vectorFor(enumeration()))))).toBe(true);
  });

  it('refuses to open on a wide band, however high the score', () => {
    // A confident 0.5 and an unsure 0.5 are different claims, and only one of them belongs in
    // front of a person. Half the rules abstaining is a reason to wait, not to act.
    const observations = enumeration();
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const unconfirmed = computeFeatures('session', 'v1:session-a', observations, asOf, WIDE, false);
    const score = scoreOutcomes(evaluateRules(unconfirmed));

    expect(score.band).toBe('low');
    expect(warrantsIncident(score)).toBe(false);
  });

  it('keys on the entity and when its activity began, not on the clock', () => {
    // What makes an incident citable six weeks later: replaying the same events has to produce
    // the same key, so a decision can be traced back to the thing it was made about.
    const first = openIncident(evaluationFor(enumeration()));
    const second = openIncident(evaluationFor(enumeration()));

    expect(first.key).toBe(second.key);
    expect(first.key).toContain('session:v1:session-a');
  });

  it('measures time-to-detect from the attempt, not from the evaluation', () => {
    const observations = enumeration();
    const evaluation = evaluationFor(observations, T0 + minutes(20));
    const incident = openIncident(evaluation);

    expect(incident.detectedAt).toBe(T0 + minutes(20));
    expect(timeToDetect(incident)).toBe(T0 + minutes(20) - incident.firstAttemptAt);
    expect(timeToDetect(incident)).toBeGreaterThan(0);
  });

  it('names the rules that fired, without the mitigating ones', () => {
    const incident = openIncident(evaluationFor(enumeration()));

    expect(firedRules(incident)).toContain('card_spread');
    expect(firedRules(incident)).not.toContain('recovery');
  });
});

describe('folding activity in', () => {
  it('keeps one incident as the burst continues', () => {
    const first = openIncident(evaluationFor(enumeration(10)));
    const later = evaluationFor(enumeration(30));
    const folded = foldInto(first, later.outcomes, later.vector, later.at);

    expect(folded.key).toBe(first.key);
    expect(folded.observations).toBe(2);
    expect(folded.firstAttemptAt).toBe(first.firstAttemptAt);
  });

  it('lets a late recovery bring the score down', () => {
    // The score describes what is true now. One that only ever grew would mean an attacker who
    // stopped stayed guilty, and — worse — that a customer who finally paid never stopped
    // looking like one.
    const attack = openIncident(evaluationFor(enumeration()));
    const recovered = [
      ...enumeration(),
      observation({ at: T0 + minutes(6), razorpayOrderId: `order_${T0}_0`, outcome: 'captured' }),
    ];
    const later = evaluationFor(recovered);

    expect(foldInto(attack, later.outcomes, later.vector, later.at).score.value).toBeLessThan(
      attack.score.value,
    );
  });

  it('does not move time-to-detect when more activity arrives', () => {
    const incident = openIncident(evaluationFor(enumeration(10)));
    const later = evaluationFor(enumeration(30));

    expect(timeToDetect(foldInto(incident, later.outcomes, later.vector, later.at))).toBe(
      timeToDetect(incident),
    );
  });

  it('claims activity inside the idle window and disowns what follows silence', () => {
    const incident = openIncident(evaluationFor(enumeration()));

    expect(belongsTo(incident, incident.lastActivityAt + minutes(5))).toBe(true);
    expect(belongsTo(incident, incident.expiresAt + 1)).toBe(false);
  });
});

describe('lifecycle', () => {
  it('allows the moves an analyst actually makes', () => {
    expect(canTransition('open', 'under_review')).toBe(true);
    expect(canTransition('under_review', 'contained')).toBe(true);
    expect(canTransition('contained', 'resolved')).toBe(true);
    // Containment that did not work goes back for another look.
    expect(canTransition('contained', 'under_review')).toBe(true);
  });

  it('treats resolved and expired as final', () => {
    // An incident that could be reopened is a record whose history can be rewritten, and the
    // only question that matters afterwards is why it was closed.
    for (const to of ['open', 'under_review', 'contained'] as IncidentStatus[]) {
      expect(canTransition('resolved', to)).toBe(false);
      expect(canTransition('expired', to)).toBe(false);
    }
  });

  it('refuses an illegal move loudly', () => {
    const incident = transition(openIncident(evaluationFor(enumeration())), 'resolved', T0);

    expect(() => transition(incident, 'open', T0)).toThrow(InvalidTransition);
    expect(() => transition(incident, 'open', T0)).toThrow(/cannot go from resolved to open/);
  });

  it('expires an incident nothing happened on', () => {
    const incident = openIncident(evaluationFor(enumeration()));

    expect(expireIfIdle(incident, incident.expiresAt).status).toBe('open');
    expect(expireIfIdle(incident, incident.expiresAt + 1).status).toBe('expired');
  });

  it('leaves a resolved incident alone rather than expiring it', () => {
    const resolved = transition(openIncident(evaluationFor(enumeration())), 'resolved', T0);
    expect(expireIfIdle(resolved, T0 + minutes(600)).status).toBe('resolved');
  });
});

describe('clustering', () => {
  it('turns one burst into exactly one incident', () => {
    // The slice's exit condition. Sixty alerts for one burst would be a worse product than
    // none: the analyst would reconstruct that they were the same thing by hand, sixty times.
    const growing = [10, 20, 30, 40, 50].map((count) => evaluationFor(enumeration(count)));
    const incidents = clusterIncidents(growing);

    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.observations).toBe(5);
    expect(incidents[0]!.severity).toBe('high');
  });

  it('starts a new incident after a long enough silence', () => {
    // Two episodes involving the same session are two incidents. Merging them would produce
    // one that never closes and therefore means nothing.
    const monday = evaluationFor(enumeration(30, T0));
    const laterOn = evaluationFor(enumeration(30, T0 + THRESHOLDS.incidentIdleMs + minutes(90)));

    expect(clusterIncidents([monday, laterOn])).toHaveLength(2);
  });

  it('opens nothing for traffic that does not warrant it', () => {
    const shopper = [
      observation({ at: T0, razorpayOrderId: 'order_1' }),
      observation({ at: T0 + 40_000, razorpayOrderId: 'order_1', outcome: 'captured' }),
    ];

    expect(clusterIncidents([evaluationFor(shopper)])).toHaveLength(0);
  });

  it('gives the same incidents twice', () => {
    const evaluations = [10, 20, 30].map((count) => evaluationFor(enumeration(count)));
    expect(JSON.stringify(clusterIncidents(evaluations))).toBe(
      JSON.stringify(clusterIncidents(evaluations)),
    );
  });
});

describe('against the corpus', () => {
  /**
   * The number the plan asks to be recorded rather than asserted loosely: how many incidents
   * each scenario family produces. The benign and operational families are the ones that
   * matter — an incident there is an analyst's afternoon spent on a merchant collecting money
   * it is owed, or on an acquirer being down.
   */
  function observationsFrom(family: Parameters<typeof generate>[0], kind: 'session' | 'network') {
    const scenario = generate(family);
    const checkouts = new Map(scenario.checkouts.map((c) => [c.razorpayOrderId, c]));

    return scenario.events
      .flatMap((event): Observation[] => {
        const body = event.body as {
          created_at: number;
          payload?: { payment?: { entity?: Record<string, unknown> } };
        };
        const entity = body.payload?.payment?.entity;
        if (entity === undefined) return [];

        const str = (v: unknown) => (typeof v === 'string' ? v : null);
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
      })
      .filter((o) => (kind === 'session' ? o.sessionPseudonym : o.ipPseudonym) !== null);
  }

  function incidentsFor(family: Parameters<typeof generate>[0], kind: 'session' | 'network') {
    const observations = observationsFrom(family, kind);
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const keys = [
      ...new Set(
        observations.map((o) => (kind === 'session' ? o.sessionPseudonym : o.ipPseudonym)),
      ),
    ].filter((k): k is string => k !== null);

    const evaluations = keys.map((key) => {
      const vector = computeFeatures(kind, key, observations, asOf, WIDE);
      return { vector, outcomes: evaluateRules(vector), at: asOf };
    });
    return clusterIncidents(evaluations);
  }

  const expected: Record<string, { kind: 'session' | 'network'; atLeast: number; atMost: number }> =
    {
      // Attacks must produce something.
      attack_loud: { kind: 'session', atLeast: 1, atMost: 1 },
      attack_low_amplitude: { kind: 'session', atLeast: 1, atMost: 3 },
      attack_distributed: { kind: 'session', atLeast: 0, atMost: 99 },
      // Operational and benign families must produce nothing. These are the expensive mistakes:
      // one is a merchant being stopped from collecting, the other is customers punished for an
      // outage.
      retry_storm: { kind: 'session', atLeast: 0, atMost: 0 },
      gateway_outage: { kind: 'network', atLeast: 0, atMost: 0 },
      flash_sale: { kind: 'session', atLeast: 0, atMost: 0 },
      customer_error: { kind: 'session', atLeast: 0, atMost: 0 },
      normal_traffic: { kind: 'session', atLeast: 0, atMost: 0 },
    };

  for (const [family, { kind, atLeast, atMost }] of Object.entries(expected)) {
    it(`produces ${atLeast === atMost ? atLeast : `${atLeast}-${atMost}`} incident(s) for ${family}`, () => {
      const incidents = incidentsFor(family as Parameters<typeof generate>[0], kind);

      expect(
        incidents.length,
        `${family}: ${incidents.map((i) => i.entityKey).join(', ')}`,
      ).toBeGreaterThanOrEqual(atLeast);
      expect(incidents.length).toBeLessThanOrEqual(atMost);
    });
  }
});

describe('the same burst seen through different keys', () => {
  /** One machine: one session, one device, one network, all describing the same attempts. */
  function threeViews() {
    const observations = enumeration();
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;

    return (['session', 'device', 'network'] as const).map((kind) => {
      const key =
        kind === 'session' ? 'v1:session-a' : kind === 'device' ? 'v1:device-a' : 'v1:network-a';
      const vector = computeFeatures(kind, key, observations, asOf, WIDE);
      return openIncident({ vector, outcomes: evaluateRules(vector), at: asOf });
    });
  }

  it('collapses to one, keeping the narrowest', () => {
    // Three rows for one thing is the same failure as sixty alerts for one burst, just
    // smaller. Session wins because containing one session is a smaller act than containing a
    // whole network for identical evidence.
    const kept = dropDuplicateViews(threeViews());

    expect(kept).toHaveLength(1);
    expect(kept[0]!.entityKind).toBe('session');
  });

  it('keeps a broader incident that is not the same activity', () => {
    // The case this must not break: when an attacker rotates sessions, no session incident
    // opens and the network-level one is the only thing that sees it.
    const [session] = threeViews();
    const wider = { ...session!, entityKind: 'network' as const, attempts: session!.attempts + 12 };

    expect(dropDuplicateViews([session!, wider])).toHaveLength(2);
  });
});

describe('what is allowed to open an incident', () => {
  it('will not open on failure alone', () => {
    // The dunning storm, seen through a thirty-minute window at network level: fourteen
    // attempts, eleven failures, eight cards. Low approval and one dominant decline reason are
    // both true — and both are equally true of a biller working through cards that are out of
    // money. Opening here would tell a merchant that collecting its own money is an incident.
    // The real shape, not a convenient one: irregular arrivals so cadence stays quiet, and one
    // order per attempt so nothing counts as a recovery.
    const gaps = [0, 40, 190, 60, 500, 120, 75, 310, 95, 140, 620, 55, 230, 180];
    let at = T0;
    const failing = gaps.map((gap, i) => {
      at += gap * 1000;
      return observation({
        at,
        razorpayOrderId: `order_${i}`,
        razorpayPaymentId: `pay_${i}`,
        cardId: `card_${i % 8}`,
        amountPaise: 149_900,
        errorReason: i % 4 === 0 ? 'card_declined' : 'insufficient_funds',
        outcome: i === 3 || i === 11 ? 'captured' : 'failed',
      });
    });

    const vector = vectorFor(failing);
    const outcomes = evaluateRules(vector);
    const score = scoreOutcomes(outcomes);

    // The failure rules do fire, and are not enough on their own.
    expect(outcomes.filter((o) => o.fired).map((o) => o.rule)).toContain('approval_collapse');
    expect(score.value).toBeGreaterThanOrEqual(0.4);
    expect(warrantsIncident(score)).toBe(false);
  });

  it('opens when something describes the traffic, not just its outcome', () => {
    const score = scoreOutcomes(evaluateRules(vectorFor(enumeration())));

    expect(score.evidence.some((e) => e.rule === 'card_spread' && e.weight > 0)).toBe(true);
    expect(warrantsIncident(score)).toBe(true);
  });
});
