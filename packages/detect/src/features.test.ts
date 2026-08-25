import { describe, expect, it } from 'vitest';
import { computeFeatures, DEFAULT_WINDOW, type Observation } from './features.js';
import { decayedCount, decayFactor, minutes } from './decay.js';
import { HyperLogLog, estimateDistinct } from './hyperloglog.js';

const T0 = Date.parse('2026-03-01T09:00:00.000Z');

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    at: T0,
    razorpayOrderId: 'order_1',
    razorpayPaymentId: 'pay_1',
    outcome: 'failed',
    amountPaise: 149_900,
    cardId: 'card_1',
    errorSource: 'bank',
    errorReason: 'card_declined',
    sessionPseudonym: 'v1:session-a',
    devicePseudonym: 'v1:device-a',
    ipPseudonym: 'v1:network-a',
    userAgentFamily: 'chrome',
    ...overrides,
  };
}

describe('decay', () => {
  it('halves a value after exactly one half-life', () => {
    expect(decayFactor(minutes(5), minutes(5))).toBeCloseTo(0.5, 10);
    expect(decayFactor(minutes(10), minutes(5))).toBeCloseTo(0.25, 10);
  });

  it('leaves something that just happened untouched', () => {
    expect(decayFactor(0, minutes(5))).toBe(1);
  });

  it('never lets a count jump because a window edge moved', () => {
    // The reason decay is used instead of a sliding window. A count that changes because a
    // clock ticked makes a threshold flicker while nothing is happening.
    const events = [T0, T0 + 1000, T0 + 2000];
    const a = decayedCount(events, T0 + minutes(10), minutes(5));
    const b = decayedCount(events, T0 + minutes(10) + 1, minutes(5));

    expect(Math.abs(a - b)).toBeLessThan(0.0001);
  });

  it('ignores anything that had not happened yet', () => {
    // A decision must not see the future, or replaying it would answer a different question
    // than the original.
    expect(decayedCount([T0 + minutes(1)], T0, minutes(5))).toBe(0);
  });
});

describe('hyperloglog', () => {
  it('estimates a large cardinality within its documented bound', () => {
    const sketch = new HyperLogLog();
    for (let i = 0; i < 10_000; i += 1) sketch.add(`card_${i}`);

    const relativeError = Math.abs(sketch.count() - 10_000) / 10_000;
    expect(relativeError).toBeLessThan(HyperLogLog.standardError * 3);
  });

  it('is exact enough on the small counts a detector actually sees', () => {
    for (const size of [1, 5, 20, 100]) {
      const sketch = new HyperLogLog();
      for (let i = 0; i < size; i += 1) sketch.add(`card_${i}`);
      expect(Math.abs(sketch.count() - size), `at ${size}`).toBeLessThanOrEqual(
        Math.max(1, size * 0.05),
      );
    }
  });

  it('counts a repeated value once', () => {
    const sketch = new HyperLogLog();
    for (let i = 0; i < 500; i += 1) sketch.add('card_same');
    expect(sketch.count()).toBe(1);
  });

  it('merges to the same answer as counting the union directly', () => {
    // The property that lets a window be the merge of its minutes.
    const a = new HyperLogLog();
    const b = new HyperLogLog();
    const both = new HyperLogLog();

    for (let i = 0; i < 400; i += 1) {
      a.add(`card_${i}`);
      both.add(`card_${i}`);
    }
    for (let i = 200; i < 600; i += 1) {
      b.add(`card_${i}`);
      both.add(`card_${i}`);
    }

    expect(a.merge(b).count()).toBe(both.count());
  });

  it('reports an error bound rather than implying none', () => {
    const sketch = new HyperLogLog();
    for (let i = 0; i < 1_000; i += 1) sketch.add(`card_${i}`);

    const estimate = estimateDistinct(sketch);
    expect(estimate.errorBound).toBeGreaterThan(0);
    // Never presented as confirmed until the exact path has run.
    expect(estimate.exact).toBeNull();
  });

  it('survives a round trip through bytes, so a tile can be stored', () => {
    const sketch = new HyperLogLog();
    for (let i = 0; i < 300; i += 1) sketch.add(`card_${i}`);

    expect(HyperLogLog.fromBytes(sketch.toBytes()).count()).toBe(sketch.count());
  });
});

describe('features', () => {
  const enumeration = Array.from({ length: 40 }, (_, i) =>
    observation({
      at: T0 + i * 4_000,
      razorpayOrderId: `order_${i}`,
      cardId: `card_${i}`,
      amountPaise: 100,
      errorReason: 'card_declined',
      errorSource: 'bank',
    }),
  );

  const dunning = Array.from({ length: 40 }, (_, i) =>
    observation({
      at: T0 + i * 60_000,
      razorpayOrderId: `order_${i}`,
      cardId: `card_${i % 6}`,
      amountPaise: 99_900,
      errorReason: 'insufficient_funds',
      errorSource: 'bank',
    }),
  );

  const asOf = T0 + minutes(20);
  const wide = { windowMs: minutes(60), halfLifeMs: minutes(10) };

  it('confirms every sketch estimate with an exact count', () => {
    const features = computeFeatures('session', 'v1:session-a', enumeration, asOf, wide);

    expect(features.distinctCards.exact).toBe(40);
    expect(features.distinctCards.estimate).toBeGreaterThan(0);
  });

  it('leaves the exact count unfilled on the discovery path', () => {
    // Candidate discovery is allowed to be approximate. A decision is not.
    const features = computeFeatures('session', 'v1:session-a', enumeration, asOf, wide, false);
    expect(features.distinctCards.exact).toBeNull();
  });

  it('separates enumeration from dunning on cards, where failures cannot', () => {
    // Both produce forty failures from one session. The card count is what tells them apart:
    // an attack walks many cards, a retry schedule hammers a few.
    const attack = computeFeatures('session', 'v1:session-a', enumeration, asOf, wide);
    const retries = computeFeatures('session', 'v1:session-a', dunning, T0 + minutes(45), wide);

    expect(attack.failures).toBe(retries.failures);
    expect(attack.distinctCards.exact).toBe(40);
    expect(retries.distinctCards.exact).toBe(6);
  });

  it('measures how much of the trouble the infrastructure owned', () => {
    // The outage discriminator. Nothing else in the vector separates an acquirer falling over
    // from an attack, and acting on the wrong one punishes customers for a bank being down.
    const outage = computeFeatures(
      'network',
      'v1:network-a',
      enumeration.map((o) => ({ ...o, errorSource: 'gateway' })),
      asOf,
      wide,
    );
    const attack = computeFeatures(
      'network',
      'v1:network-a',
      enumeration.map((o) => ({ ...o, errorSource: 'customer' })),
      asOf,
      wide,
    );

    expect(outage.infrastructureFailureShare).toBe(1);
    expect(attack.infrastructureFailureShare).toBe(0);
  });

  it('does not treat a bank declining a card as infrastructure trouble', () => {
    // The case the two-extremes test above missed, and the one that matters. `bank` sounds
    // like infrastructure and is not: Razorpay attributes an issuer refusing a card to the
    // bank, so it is the dominant source in every attack in the corpus. Counting it made this
    // feature read 1.0 for a dunning run, which is the exact confusion it exists to prevent.
    const declined = computeFeatures(
      'network',
      'v1:network-a',
      enumeration.map((o) => ({ ...o, errorSource: 'bank', errorReason: 'card_declined' })),
      asOf,
      wide,
    );

    expect(declined.failures).toBeGreaterThan(0);
    expect(declined.infrastructureFailureShare).toBe(0);
  });

  it('records a recovery, so a declined customer is not counted as an attacker', () => {
    const recovered = [
      observation({ at: T0, razorpayOrderId: 'order_1', outcome: 'failed' }),
      observation({ at: T0 + 30_000, razorpayOrderId: 'order_1', outcome: 'captured' }),
      observation({ at: T0 + 60_000, razorpayOrderId: 'order_2', outcome: 'captured' }),
    ];

    const features = computeFeatures('session', 'v1:session-a', recovered, asOf, wide);
    expect(features.recoveredOrders).toBe(1);
    expect(features.recoveryRate).toBeCloseTo(0.5, 5);
  });

  it('sees no recovery where every attempt failed', () => {
    const features = computeFeatures('session', 'v1:session-a', enumeration, asOf, wide);
    expect(features.recoveryRate).toBe(0);
  });

  it('flags probing at trivial amounts', () => {
    const features = computeFeatures('session', 'v1:session-a', enumeration, asOf, wide);
    expect(features.smallAmountShare).toBe(1);
    expect(features.medianAmountPaise).toBe(100);
  });

  it('reads a metronome as less bursty than independent arrivals', () => {
    const metronome = Array.from({ length: 20 }, (_, i) =>
      observation({ at: T0 + i * 10_000, razorpayOrderId: `order_${i}` }),
    );
    const scattered = [0, 1, 2, 40, 41, 90, 91, 92, 93, 200].map((s, i) =>
      observation({ at: T0 + s * 1_000, razorpayOrderId: `order_${i}` }),
    );

    const even = computeFeatures('session', 'v1:session-a', metronome, asOf, wide);
    const uneven = computeFeatures('session', 'v1:session-a', scattered, asOf, wide);

    expect(even.burstiness).toBeCloseTo(0, 5);
    expect(uneven.burstiness).toBeGreaterThan(even.burstiness);
  });

  it('finds one repeated decline reason more concentrated than many', () => {
    const varied = enumeration.map((o, i) => ({ ...o, errorReason: `reason_${i % 5}` }));

    const single = computeFeatures('session', 'v1:session-a', enumeration, asOf, wide);
    const mixed = computeFeatures('session', 'v1:session-a', varied, asOf, wide);

    expect(single.reasonConcentration).toBe(1);
    expect(mixed.reasonConcentration).toBeLessThan(0.3);
  });

  it('computes for the entity a decision would act on', () => {
    const spread = enumeration.map((o, i) => ({ ...o, ipPseudonym: `v1:network-${i % 4}` }));
    const network = computeFeatures('network', 'v1:network-0', spread, asOf, wide);

    expect(network.entityKind).toBe('network');
    expect(network.attempts).toBe(10);
  });

  it('sees nothing outside its window', () => {
    const old = [observation({ at: T0 - minutes(90) })];
    expect(computeFeatures('session', 'v1:session-a', old, asOf, DEFAULT_WINDOW).attempts).toBe(0);
  });

  it('returns a usable vector for an entity it has never seen', () => {
    const features = computeFeatures('session', 'v1:nobody', enumeration, asOf, wide);

    expect(features.attempts).toBe(0);
    expect(features.approvalRate).toBe(0);
    expect(features.medianAmountPaise).toBeNull();
  });
});
