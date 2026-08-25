import { describe, expect, it } from 'vitest';
import { computeFeatures, type Observation } from './features.js';
import { decayedCount, minutes } from './decay.js';
import { decayedFromTiles, mergeTiles, minuteOf, tileize, MINUTE } from './tiles.js';
import { generate } from '@sentinel/corpus';

const T0 = Date.parse('2026-03-01T09:00:00.000Z');

/**
 * Observations drawn from the committed corpus rather than invented here.
 *
 * A parity test on data written to make parity easy proves nothing. These are the same events
 * the replay harness writes, with the same shapes and the same skew.
 */
type Entity = Record<string, unknown>;

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const numeric = (value: unknown): number | null => (typeof value === 'number' ? value : null);

function outcomeOf(status: string | null): Observation['outcome'] {
  if (status === 'captured') return 'captured';
  if (status === 'failed') return 'failed';
  if (status === 'authorized') return 'authorized';
  return 'other';
}

function fromCorpus(family: Parameters<typeof generate>[0]): Observation[] {
  const scenario = generate(family);
  const checkouts = new Map(scenario.checkouts.map((c) => [c.razorpayOrderId, c]));

  return scenario.events.flatMap((event): Observation[] => {
    const body = event.body as {
      created_at: number;
      payload?: { payment?: { entity?: Entity } };
    };
    const entity = body.payload?.payment?.entity;
    if (entity === undefined) return [];

    const orderId = str(entity['order_id']) ?? '';
    const checkout = checkouts.get(orderId);

    return [
      {
        at: body.created_at * 1000,
        razorpayOrderId: orderId,
        razorpayPaymentId: str(entity['id']) ?? '',
        outcome: outcomeOf(str(entity['status'])),
        amountPaise: numeric(entity['amount']),
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

describe('tiles', () => {
  it('buckets to the minute', () => {
    expect(minuteOf(T0 + 59_999)).toBe(T0);
    expect(minuteOf(T0 + 60_001)).toBe(T0 + MINUTE);
  });

  it('keeps one tile per entity per minute', () => {
    const events = [
      observation({ at: T0 }),
      observation({ at: T0 + 30_000 }),
      observation({ at: T0 + 90_000 }),
      observation({ at: T0, sessionPseudonym: 'v1:session-b' }),
    ];

    expect(tileize(events, 'session').size).toBe(3);
  });
});

describe('tile merge equals the naive computation', () => {
  // The property everything else rests on. A merge that quietly disagreed with folding the
  // events directly would make every feature wrong in a way no single number would reveal.
  const families = ['normal_traffic', 'attack_loud', 'retry_storm', 'gateway_outage'] as const;

  for (const family of families) {
    it(`holds for ${family}`, () => {
      const observations = fromCorpus(family);
      expect(observations.length).toBeGreaterThan(20);

      const bySession = new Map<string, Observation[]>();
      for (const o of observations) {
        if (o.sessionPseudonym === null) continue;
        const list = bySession.get(o.sessionPseudonym) ?? [];
        list.push(o);
        bySession.set(o.sessionPseudonym, list);
      }

      const tiles = tileize(observations, 'session');

      for (const [key, events] of bySession) {
        const merged = mergeTiles([...tiles.values()].filter((t) => t.entityKey === key));
        expect(merged, key).not.toBeNull();

        // Counters must agree exactly.
        expect(merged!.attempts, `${key} attempts`).toBe(events.length);
        expect(merged!.failures, `${key} failures`).toBe(
          events.filter((e) => e.outcome === 'failed').length,
        );
        expect(merged!.captures, `${key} captures`).toBe(
          events.filter((e) => e.outcome === 'captured').length,
        );

        // Sketches are approximate by construction, so they are held to their bound rather
        // than to equality — and the exact count is what a decision would use anyway.
        const exactCards = new Set(
          events.map((e) => e.cardId).filter((c): c is string => c !== null),
        ).size;
        const estimated = merged!.cards.count();
        expect(Math.abs(estimated - exactCards), `${key} cards`).toBeLessThanOrEqual(
          Math.max(2, exactCards * 0.1),
        );
      }
    });
  }
});

describe('online and offline agree', () => {
  /**
   * The skew measurement the architecture calls for.
   *
   * "Online" is the incremental path: minute tiles, merged, decayed from bucket midpoints.
   * "Offline" is the same definition executed over the raw events. They cannot be identical —
   * the tile path deliberately trades per-event timestamps for a fixed cost per minute — so
   * the test asserts the disagreement stays inside the bound that trade implies, and would
   * fail if the two ever drifted apart for any other reason.
   */
  it('keeps decayed counts within the bound bucketing implies', () => {
    const observations = fromCorpus('attack_loud');
    const key = observations.find((o) => o.sessionPseudonym !== null)!.sessionPseudonym!;
    const mine = observations.filter((o) => o.sessionPseudonym === key);

    const asOf = Math.max(...mine.map((o) => o.at)) + minutes(1);
    const halfLife = minutes(5);

    const offline = decayedCount(
      mine.map((o) => o.at),
      asOf,
      halfLife,
    );

    const tiles = [...tileize(mine, 'session').values()];
    const online = decayedFromTiles(tiles, 'attempts', asOf, halfLife);

    // Every event in a minute is treated as having happened at its midpoint, so the worst
    // case shift is thirty seconds — a tenth of a half-life, or about 7%.
    const skew = Math.abs(online - offline) / offline;
    expect(skew).toBeLessThan(0.07);
  });

  it('agrees exactly on anything not time-weighted', () => {
    // Where no approximation is involved, none is tolerated.
    const observations = fromCorpus('gateway_outage');
    const key = observations.find((o) => o.sessionPseudonym !== null)!.sessionPseudonym!;
    const mine = observations.filter((o) => o.sessionPseudonym === key);

    const merged = mergeTiles([...tileize(mine, 'session').values()])!;
    const asOf = Math.max(...mine.map((o) => o.at)) + minutes(1);
    const features = computeFeatures('session', key, mine, asOf, {
      windowMs: minutes(600),
      halfLifeMs: minutes(5),
    });

    expect(merged.attempts).toBe(features.attempts);
    expect(merged.failures).toBe(features.failures);
  });

  it('reaches the same recovery count either way', () => {
    // The mitigating signal has to survive aggregation, or a recovered customer looks like an
    // attacker the moment the feature is read from tiles instead of events.
    const observations = fromCorpus('customer_error');
    const key = observations.find((o) => o.sessionPseudonym !== null)!.sessionPseudonym!;
    const mine = observations.filter((o) => o.sessionPseudonym === key);

    const merged = mergeTiles([...tileize(mine, 'session').values()])!;
    let recovered = 0;
    for (const order of merged.orders.values()) if (order.failed && order.settled) recovered += 1;

    const asOf = Math.max(...mine.map((o) => o.at)) + minutes(1);
    const features = computeFeatures('session', key, mine, asOf, {
      windowMs: minutes(600),
      halfLifeMs: minutes(5),
    });

    expect(recovered).toBe(features.recoveredOrders);
  });
});

describe('the outage discriminator, against the corpus rather than invented data', () => {
  /**
   * The definition of `infrastructureFailureShare` is only useful if it separates the one
   * scenario where a component failed from the ones where cards were refused. Asserted over
   * every family so that widening the definition — to `bank`, say, which sounds like
   * infrastructure and is not — fails here rather than in a console six weeks later.
   */
  const families = [
    'gateway_outage',
    'attack_loud',
    'attack_distributed',
    'retry_storm',
    'flash_sale',
    'normal_traffic',
  ] as const;

  for (const family of families) {
    it(`reads ${family} correctly`, () => {
      const observations = fromCorpus(family);
      const asOf = Math.max(...observations.map((o) => o.at));
      const keys = [...new Set(observations.map((o) => o.ipPseudonym))].filter(
        (k): k is string => k !== null,
      );

      const vectors = keys
        .map((key) =>
          computeFeatures('network', key, observations, asOf, {
            windowMs: minutes(600),
            halfLifeMs: minutes(5),
          }),
        )
        .filter((v) => v.failures > 0);

      expect(vectors.length).toBeGreaterThan(0);

      if (family === 'gateway_outage') {
        expect(vectors.every((v) => v.infrastructureFailureShare === 1)).toBe(true);
      } else {
        expect(vectors.every((v) => v.infrastructureFailureShare === 0)).toBe(true);
      }
    });
  }
});
