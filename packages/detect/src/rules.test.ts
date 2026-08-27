import { describe, expect, it } from 'vitest';
import {
  computeFeatures,
  DEFAULT_WINDOW,
  type FeatureVector,
  type Observation,
} from './features.js';
import { evaluateRules, type RuleId } from './rules.js';
import { RULE_WEIGHT, scoreOutcomes } from './score.js';
import { THRESHOLDS, thresholdHash } from './thresholds.js';
import { minutes } from './decay.js';
import { seeded } from '@sentinel/corpus';

const T0 = Date.parse('2026-03-01T09:00:00.000Z');
const WIDE = { windowMs: minutes(600), halfLifeMs: minutes(5) };

function observation(overrides: Partial<Observation> = {}): Observation {
  const merged: Observation = {
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

  // A distinct payment per attempt unless a test says otherwise. Sharing an id now means "the
  // same payment, seen again through another webhook", which is not what these fixtures mean —
  // and left at a constant it collapsed forty attempts into one.
  return {
    ...merged,
    razorpayPaymentId: overrides.razorpayPaymentId ?? `pay_${merged.sessionPseudonym}_${merged.at}`,
  };
}

function vectorFrom(observations: readonly Observation[]): FeatureVector {
  const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
  return computeFeatures('session', 'v1:session-a', observations, asOf, WIDE);
}

/** One session walking a card list: the loud enumeration shape. */
function enumeration(count = 30): Observation[] {
  return Array.from({ length: count }, (_, i) =>
    observation({
      at: T0 + i * 10_000,
      razorpayOrderId: `order_${i}`,
      razorpayPaymentId: `pay_${i}`,
      cardId: `card_${i}`,
      amountPaise: 100,
      errorReason: 'invalid_card',
    }),
  );
}

/** A biller retrying a few cards on a schedule: the shape that must not be an attack. */
function dunning(count = 24): Observation[] {
  return Array.from({ length: count }, (_, i) =>
    observation({
      at: T0 + i * 60_000,
      razorpayOrderId: `order_${i % 4}`,
      razorpayPaymentId: `pay_${i}`,
      cardId: `card_${i % 4}`,
      errorReason: 'insufficient_funds',
    }),
  );
}

/** One stolen card walked across many separate orders: the probing shape. */
function oneCardManyItems(count = 6): Observation[] {
  return Array.from({ length: count }, (_, i) =>
    observation({
      at: T0 + i * 20_000,
      razorpayOrderId: `order_${i}`,
      razorpayPaymentId: `pay_${i}`,
      cardId: 'card_stolen',
      amountPaise: 100,
      errorReason: 'invalid_card',
    }),
  );
}

/** Enumeration paced one card every few minutes, under the live window but inside the long span. */
function slowEnumeration(count = 14): Observation[] {
  return Array.from({ length: count }, (_, i) =>
    observation({
      at: T0 + i * minutes(6),
      razorpayOrderId: `order_${i}`,
      razorpayPaymentId: `pay_${i}`,
      cardId: `card_${i}`,
      amountPaise: 100,
      errorReason: 'invalid_card',
    }),
  );
}

/** Computed over the real live/long-span windows, which is what the slow-and-wide rule reasons about. */
function liveVector(observations: readonly Observation[]): FeatureVector {
  const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
  return computeFeatures('session', 'v1:session-a', observations, asOf, DEFAULT_WINDOW);
}

const outcomeFor = (vector: FeatureVector, rule: RuleId) =>
  evaluateRules(vector).find((outcome) => outcome.rule === rule)!;

describe('thresholds', () => {
  it('fingerprints its values, not their order', () => {
    // The pre-registration mechanism. A moved key is not a changed threshold and must not read
    // as one, or the hash becomes noise and nobody looks at it.
    const reordered = Object.fromEntries(
      Object.entries(THRESHOLDS)
        .reverse()
        .map(([k, v]) => [k, v]),
    ) as typeof THRESHOLDS;

    expect(thresholdHash(reordered)).toBe(thresholdHash(THRESHOLDS));
    expect(thresholdHash({ ...THRESHOLDS, velocityPerMinute: 1.6 })).not.toBe(
      thresholdHash(THRESHOLDS),
    );
  });
});

describe('rules', () => {
  it('separates enumeration from dunning', () => {
    // The whole point of the tier. Both are machines, both fail constantly, and only one
    // should end up anywhere near an action.
    const attack = scoreOutcomes(evaluateRules(vectorFrom(enumeration())));
    const biller = scoreOutcomes(evaluateRules(vectorFrom(dunning())));

    expect(attack.value).toBeGreaterThan(biller.value);
    expect(outcomeFor(vectorFrom(enumeration()), 'card_spread').fired).toBe(true);
    expect(outcomeFor(vectorFrom(dunning()), 'card_spread').fired).toBe(false);
    expect(outcomeFor(vectorFrom(dunning()), 'card_reuse').fired).toBe(true);
  });

  it('catches one card walked across many items, but not a shopper buying several', () => {
    // The other card-testing shape: a single card pushed at order after order. It means nothing
    // when the payments clear — that is a cart — so the rule only fires where approval collapsed.
    const probing = outcomeFor(vectorFrom(oneCardManyItems()), 'card_probing');
    expect(probing.fired).toBe(true);
    expect(probing.evidence[0]?.weight).toBeCloseTo(RULE_WEIGHT.card_probing, 10);

    const cart = oneCardManyItems(5).map((o) => ({ ...o, outcome: 'captured' as const }));
    expect(outcomeFor(vectorFrom(cart), 'card_probing').fired).toBe(false);
  });

  it('catches enumeration paced under the live window, and defers to the burst gate on the loud one', () => {
    // The slow-and-wide counterpart to card_spread. One card every few minutes stays under the
    // 30-minute window but adds up across the long span; the rule reads that and fires.
    const slow = liveVector(slowEnumeration());
    expect(outcomeFor(slow, 'card_spread').fired).toBe(false); // too few inside the live window
    const outcome = outcomeFor(slow, 'card_spread_slow');
    expect(outcome.fired).toBe(true);
    expect(outcome.evidence[0]?.weight).toBeCloseTo(RULE_WEIGHT.card_spread_slow, 10);

    // On a loud burst the short window already has it, so the slow rule stays quiet rather than
    // scoring the same enumeration twice.
    expect(outcomeFor(vectorFrom(enumeration()), 'card_spread').fired).toBe(true);
    expect(outcomeFor(vectorFrom(enumeration()), 'card_spread_slow').fired).toBe(false);
  });

  it('will not judge slow spread on an unconfirmed estimate either', () => {
    const observations = slowEnumeration();
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const unconfirmed = computeFeatures(
      'session',
      'v1:session-a',
      observations,
      asOf,
      DEFAULT_WINDOW,
      false,
    );
    expect(outcomeFor(unconfirmed, 'card_spread_slow').abstained).toBe('unconfirmed-estimate');
  });

  it('refuses to judge card spread on an unconfirmed estimate', () => {
    // The rule that would be easiest to get wrong, and the most damaging: accusing somebody on
    // a sketch. It has to abstain, and it has to say that is why.
    const observations = enumeration();
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const unconfirmed = computeFeatures('session', 'v1:session-a', observations, asOf, WIDE, false);

    const outcome = outcomeFor(unconfirmed, 'card_spread');
    expect(outcome.fired).toBe(false);
    expect(outcome.abstained).toBe('unconfirmed-estimate');
    expect(outcome.evidence).toHaveLength(0);
  });

  it('does not read an outage as an attack', () => {
    const outage = enumeration(20).map((o) => ({
      ...o,
      errorSource: 'gateway',
      errorReason: 'gateway_timeout',
      cardId: `card_${o.razorpayOrderId}`,
    }));
    const outcomes = evaluateRules(vectorFrom(outage));

    expect(outcomeFor(vectorFrom(outage), 'infrastructure_attribution').fired).toBe(true);
    // Concentration is at its maximum here — every failure has the same reason — and the rule
    // still has to stay quiet, because that is what an outage looks like too.
    expect(outcomeFor(vectorFrom(outage), 'reason_mix').fired).toBe(false);
    expect(scoreOutcomes(outcomes).mitigating).toBeLessThan(0);
  });

  it('treats a recovered customer as mitigating rather than as two failures', () => {
    const shopper = [
      observation({ at: T0, razorpayOrderId: 'order_1', outcome: 'failed' }),
      observation({ at: T0 + 40_000, razorpayOrderId: 'order_1', outcome: 'captured' }),
    ];

    expect(outcomeFor(vectorFrom(shopper), 'recovery').fired).toBe(true);
    expect(scoreOutcomes(evaluateRules(vectorFrom(shopper))).value).toBe(0);
  });

  it('stays silent rather than clearing an entity it cannot judge', () => {
    // Silence and a finding are different things. On two attempts there is nothing to say
    // about approval or cadence, and the outcome has to record that it could not run.
    const barely = [observation({ at: T0 }), observation({ at: T0 + 5_000 })];
    const vector = vectorFrom(barely);

    expect(outcomeFor(vector, 'approval_collapse').abstained).toBe('insufficient-data');
    expect(outcomeFor(vector, 'machine_cadence').abstained).toBe('insufficient-data');
    expect(outcomeFor(vector, 'approval_collapse').fired).toBe(false);
  });

  it('emits codes and numbers, never prose', () => {
    // A sentence assembled here would drift from what happened the first time somebody
    // improved the wording. Everything a reader sees is rendered from these at the edge.
    for (const item of evaluateRules(vectorFrom(enumeration())).flatMap((o) => o.evidence)) {
      expect(item.code).toMatch(/^[a-z0-9_]+$/);
      expect(Number.isFinite(item.observed)).toBe(true);
      expect(Number.isFinite(item.threshold)).toBe(true);
    }
  });
});

describe('scoring', () => {
  it('declares the same weight the rules actually contribute', () => {
    // RULE_WEIGHT is duplicated from the rule bodies so the band can reason about a rule that
    // never ran. Duplication that is not checked is duplication that goes stale.
    const fired = new Map<RuleId, number>();
    for (const observations of [
      enumeration(),
      dunning(),
      enumeration(20).map((o) => ({
        ...o,
        errorSource: 'gateway',
        errorReason: 'gateway_timeout',
      })),
    ]) {
      for (const outcome of evaluateRules(vectorFrom(observations))) {
        if (!outcome.fired) continue;
        fired.set(
          outcome.rule,
          outcome.evidence.reduce((sum, e) => sum + e.weight, 0),
        );
      }
    }

    expect(fired.size).toBeGreaterThan(4);
    for (const [rule, weight] of fired) {
      expect(weight, rule).toBeCloseTo(RULE_WEIGHT[rule], 10);
    }
  });

  it('is the sum of its evidence, and nothing else', () => {
    const score = scoreOutcomes(evaluateRules(vectorFrom(enumeration())));
    const sum = score.evidence.reduce((total, item) => total + item.weight, 0);

    expect(score.value).toBeCloseTo(Math.min(Math.max(sum, 0), 1), 3);
    expect(score.incriminating + score.mitigating).toBeCloseTo(sum, 10);
  });

  it('widens the band for a rule that could not run, rather than scoring it zero', () => {
    // Missing information must not read as innocence. An unconfirmed sketch means card_spread
    // might have contributed 0.5, and the interval has to say so.
    const observations = enumeration();
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const unconfirmed = computeFeatures('session', 'v1:session-a', observations, asOf, WIDE, false);

    const score = scoreOutcomes(evaluateRules(unconfirmed));
    expect(score.abstentions.map((a) => a.rule)).toContain('card_spread');
    expect(score.upper).toBeGreaterThan(score.value);
    expect(score.band).not.toBe('high');
  });

  it('reports high confidence only when every rule could run', () => {
    const score = scoreOutcomes(evaluateRules(vectorFrom(enumeration())));
    expect(score.abstentions).toHaveLength(0);
    expect(score.band).toBe('high');
    expect(score.lower).toBe(score.upper);
  });

  it('never leaves the unit interval, whatever it is given', () => {
    // Property test over generated vectors rather than chosen ones: a score outside [0,1] is
    // meaningless downstream, and clamping is easy to lose in a refactor.
    const random = seeded(20260825);

    for (let run = 0; run < 400; run += 1) {
      const count = 1 + Math.floor(random() * 40);
      const observations = Array.from({ length: count }, (_, i) =>
        observation({
          at: T0 + Math.floor(random() * minutes(60)),
          razorpayOrderId: `order_${Math.floor(random() * 8)}`,
          cardId: random() < 0.5 ? `card_${i}` : `card_${Math.floor(random() * 3)}`,
          outcome: random() < 0.3 ? 'captured' : 'failed',
          amountPaise: Math.floor(random() * 200_000),
          errorSource: random() < 0.3 ? 'gateway' : 'bank',
          errorReason: random() < 0.5 ? 'invalid_card' : 'insufficient_funds',
        }),
      );

      const score = scoreOutcomes(evaluateRules(vectorFrom(observations)));
      expect(score.value).toBeGreaterThanOrEqual(0);
      expect(score.value).toBeLessThanOrEqual(1);
      expect(score.lower).toBeLessThanOrEqual(score.value);
      expect(score.upper).toBeGreaterThanOrEqual(score.value);
    }
  });

  it('is monotone in mitigating evidence', () => {
    // Adding a reason not to act must never make the case for acting stronger. Easy to break
    // by flipping a sign, and catastrophic if it happens.
    const base = enumeration();
    const withRecovery = [
      ...base,
      observation({ at: T0 + 400_000, razorpayOrderId: 'order_0', outcome: 'captured' }),
    ];

    expect(scoreOutcomes(evaluateRules(vectorFrom(withRecovery))).value).toBeLessThanOrEqual(
      scoreOutcomes(evaluateRules(vectorFrom(base))).value,
    );
  });

  it('gives the same answer twice', () => {
    const first = scoreOutcomes(evaluateRules(vectorFrom(enumeration())));
    const second = scoreOutcomes(evaluateRules(vectorFrom(enumeration())));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
