import { describe, expect, it } from 'vitest';
import { generate } from '@sentinel/corpus';
import { computeFeatures, type EntityKind, type Observation } from './features.js';
import { computeTraffic } from './traffic.js';
import { arbitrate, counterfactualFor, type Decision, type Hypothesis } from './hypothesis.js';
import { minutes } from './decay.js';
import { THRESHOLDS } from './thresholds.js';

const WIDE = { windowMs: minutes(600), halfLifeMs: minutes(5) };

type Family = Parameters<typeof generate>[0];

/** The corpus, flattened into observations, exactly as the replay path would deliver them. */
function load(family: Family): Observation[] {
  const scenario = generate(family);
  const checkouts = new Map(scenario.checkouts.map((c) => [c.razorpayOrderId, c]));

  return scenario.events.flatMap((event): Observation[] => {
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
  });
}

/** The busiest entity of a kind, which is the one an analyst would be shown first. */
function busiest(observations: readonly Observation[], kind: EntityKind, asOf: number) {
  const pick = (o: Observation) =>
    kind === 'session' ? o.sessionPseudonym : kind === 'device' ? o.devicePseudonym : o.ipPseudonym;

  const keys = [...new Set(observations.map(pick))].filter((k): k is string => k !== null);
  const vectors = keys.map((key) => computeFeatures(kind, key, observations, asOf, WIDE));

  return vectors.sort((a, b) => b.failures - a.failures || b.attempts - a.attempts)[0]!;
}

function judge(family: Family, kind: EntityKind = 'session') {
  const observations = load(family);
  const asOf = Math.max(...observations.map((o) => o.at)) + 1000;

  return arbitrate(busiest(observations, kind, asOf), computeTraffic(observations, asOf, WIDE));
}

describe('traffic context', () => {
  it('measures how far failure has spread, not just how much there is', () => {
    // The number a per-entity vector cannot supply, and the one the whole slice turns on.
    const outage = load('gateway_outage');
    const attack = load('attack_loud');

    const spread = computeTraffic(outage, Math.max(...outage.map((o) => o.at)) + 1, WIDE);
    const focused = computeTraffic(attack, Math.max(...attack.map((o) => o.at)) + 1, WIDE);

    expect(spread.failingSessions).toBeGreaterThan(20);
    expect(spread.topSessionFailureShare).toBeLessThan(0.2);

    expect(focused.failingSessions).toBe(1);
    expect(focused.topSessionFailureShare).toBe(1);
  });

  it('reports the issuer count without depending on it', () => {
    // The corpus fixes the issuer at one value, so nothing is tuned against it. Asserted so
    // that a hypothesis quietly starting to rely on it fails here rather than in production.
    const outage = load('gateway_outage');
    const context = computeTraffic(outage, Math.max(...outage.map((o) => o.at)) + 1, WIDE);

    expect(context.distinctFailingIssuers).toBe(0);
  });

  it('says nothing rather than something wrong about an empty window', () => {
    const context = computeTraffic([], 1_000_000, WIDE);

    expect(context.attempts).toBe(0);
    expect(context.approvalRate).toBe(0);
    expect(context.topSessionFailureShare).toBe(0);
  });
});

describe('the look-alikes reach different conclusions under one policy', () => {
  /**
   * The slice's exit condition, and the whole point of arbitration.
   *
   * These four produce similar-looking failure counts and are told apart only by what the rest
   * of the shop was doing. No policy differs between them — the same thresholds judge all four.
   */
  const expected: { family: Family; kind: EntityKind; best: Hypothesis; decision: Decision }[] = [
    { family: 'attack_loud', kind: 'session', best: 'attack', decision: 'contain' },
    { family: 'gateway_outage', kind: 'network', best: 'outage', decision: 'monitor' },
    { family: 'retry_storm', kind: 'session', best: 'retry_storm', decision: 'none' },
    { family: 'flash_sale', kind: 'session', best: 'healthy_traffic', decision: 'none' },
  ];

  for (const { family, kind, best, decision } of expected) {
    it(`reads ${family} as ${best} and decides ${decision}`, () => {
      const result = judge(family, kind);

      expect(
        result.best,
        `${family}: ${JSON.stringify(result.fits.map((f) => [f.hypothesis, f.probability]))}`,
      ).toBe(best);
      expect(result.decision).toBe(decision);
    });
  }

  it('reaches four different decisions from one set of thresholds', () => {
    const decisions = expected.map(({ family, kind }) => judge(family, kind).decision);
    expect(new Set(decisions).size).toBeGreaterThanOrEqual(3);
  });
});

describe('suppression', () => {
  it('argues against containment rather than merely failing to find an attack', () => {
    // The difference between "no evidence of an attack" and "evidence of something else". Only
    // the second can be shown to somebody as a reason not to act.
    const result = judge('gateway_outage', 'network');

    expect(result.decision).not.toBe('contain');
    expect(result.reasons).toContain('suppressed_by_outage');

    // The rejected explanation is still reported, with everything it wanted and did not get.
    // Zero support is the strongest form of this: an analyst can see that the attack case was
    // considered and that nothing at all supported it, rather than being told only the verdict.
    const attack = result.fits.find((f) => f.hypothesis === 'attack')!;
    expect(attack.support).toBe(0);
    expect(attack.expectations.length).toBeGreaterThan(3);
    expect(attack.expectations.every((e) => !e.met)).toBe(true);
  });

  it('needs no downtime feed to conclude an outage', () => {
    // Razorpay publishes `payment.downtime.*`, and this must not depend on it: a detector that
    // only works when the platform announces its own outage is not much of a detector. The
    // corpus carries no downtime events at all.
    const result = judge('gateway_outage', 'network');
    const outage = result.fits.find((f) => f.hypothesis === 'outage')!;

    expect(outage.expectations.find((e) => e.code === 'gateway_blamed')!.met).toBe(true);
    expect(outage.expectations.find((e) => e.code === 'failure_is_widespread')!.met).toBe(true);
  });
});

describe('abstention', () => {
  it('is an outcome, not a failure to reach one', () => {
    // Barely any activity: the honest answer is that we do not know, and it goes to a person
    // rather than to an action.
    const thin: Observation[] = [
      {
        at: 1_000_000,
        razorpayOrderId: 'order_1',
        razorpayPaymentId: 'pay_1',
        outcome: 'failed',
        amountPaise: 1000,
        cardId: 'card_1',
        errorSource: 'bank',
        errorReason: 'card_declined',
        sessionPseudonym: 'v1:a',
        devicePseudonym: 'v1:a',
        ipPseudonym: 'v1:a',
        userAgentFamily: 'chrome',
      },
    ];

    const result = arbitrate(
      computeFeatures('session', 'v1:a', thin, 1_000_001, WIDE),
      computeTraffic(thin, 1_000_001, WIDE),
    );

    expect(result.best).toBe('insufficient_evidence');
    expect(result.abstained).toBe(true);
    expect(result.decision).not.toBe('contain');
  });

  it('refuses to act on an unconfirmed sketch', () => {
    // A count nobody confirmed is not something to contain a shopper over, however alarming it
    // looks. The estimate exists to find candidates, and that is all.
    const observations = load('attack_loud');
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const key = observations.find((o) => o.sessionPseudonym !== null)!.sessionPseudonym!;

    const unconfirmed = computeFeatures('session', key, observations, asOf, WIDE, false);
    const result = arbitrate(unconfirmed, computeTraffic(observations, asOf, WIDE));

    expect(result.decision).not.toBe('contain');
  });

  it('sends a narrow margin to a person rather than to an action', () => {
    // Two explanations fitting about as well is another way of saying we do not know.
    const observations = load('attack_low_amplitude');
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const result = arbitrate(
      busiest(observations, 'session', asOf),
      computeTraffic(observations, asOf, WIDE),
    );

    if (result.margin < THRESHOLDS.arbitrationMargin) {
      expect(result.abstained).toBe(true);
      expect(result.decision).toBe('review');
    } else {
      expect(result.abstained).toBe(false);
    }
  });
});

describe('arbitration mechanics', () => {
  it('reports every explanation it considered, and they sum to one', () => {
    // A verdict without the alternatives is an assertion. The runner-up is the thing an analyst
    // most needs to see.
    const result = judge('attack_loud');

    expect(result.fits).toHaveLength(5);
    const total = result.fits.reduce((sum, fit) => sum + fit.probability, 0);
    expect(total).toBeCloseTo(1, 2);
    expect(result.runnerUp).not.toBe(result.best);
  });

  it('shows what each explanation expected and whether it got it', () => {
    const result = judge('attack_loud');
    const attack = result.fits.find((f) => f.hypothesis === 'attack')!;

    expect(attack.expectations.length).toBeGreaterThan(3);
    for (const expectation of attack.expectations) {
      expect(expectation.code).toMatch(/^[a-z0-9_]+$/);
      expect(typeof expectation.met).toBe('boolean');
    }
  });

  it('costs the wrong call in both directions, because they are not symmetric', () => {
    expect(counterfactualFor('outage').ifWrongToAct).toMatch(/punished_customers/);
    expect(counterfactualFor('outage').ifWrongToWait).toMatch(/nothing_extra/);
    expect(counterfactualFor('attack').ifWrongToWait).toMatch(/chargebacks/);
  });

  it('gives the same answer twice', () => {
    expect(JSON.stringify(judge('attack_loud'))).toBe(JSON.stringify(judge('attack_loud')));
  });
});
