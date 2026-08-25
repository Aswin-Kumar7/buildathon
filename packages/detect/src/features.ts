import { decayedCount, minutes } from './decay.js';
import { HyperLogLog, estimateDistinct, type DistinctEstimate } from './hyperloglog.js';

/**
 * One observed payment attempt, reduced to what a feature can read.
 *
 * Deliberately narrow. Everything here comes from the redacted canonical event or the
 * storefront's own record; nothing identifies a person, and a feature that wanted something
 * that did would have to justify it at this boundary rather than deep inside a calculation.
 */
export interface Observation {
  at: number;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  outcome: 'captured' | 'authorized' | 'failed' | 'other';
  amountPaise: number | null;
  cardId: string | null;
  /** Razorpay's attribution: `customer`, `bank`, `gateway`, `business`. */
  errorSource: string | null;
  errorReason: string | null;
  sessionPseudonym: string | null;
  devicePseudonym: string | null;
  ipPseudonym: string | null;
  userAgentFamily: string | null;
}

/**
 * Collapses events to one row per payment attempt.
 *
 * A payment emits several webhooks — authorized, then captured, then the order paid — and each
 * carries the payment entity. Counting them as attempts inflates the denominator of every rate
 * by however many events a *successful* payment happens to produce, which in the corpus is
 * nearly three; a failed one produces a single event and is counted honestly.
 *
 * The effect was to crush the approval rate of healthy traffic while leaving an attack's
 * untouched, so the detector separated them better than it deserved to. Applied inside the pure
 * functions rather than left to callers, because a definition that has to be remembered at five
 * call sites is one that will be forgotten at the sixth.
 *
 * The surviving row keeps the earliest arrival — when the shopper actually tried — and the
 * furthest-along outcome, resolved by the same ranking the payment state machine uses.
 */
const OUTCOME_RANK: Record<Observation['outcome'], number> = {
  other: 0,
  failed: 1,
  authorized: 2,
  captured: 3,
};

export function perPayment(observations: readonly Observation[]): Observation[] {
  const byPayment = new Map<string, Observation>();
  const unkeyed: Observation[] = [];

  for (const observation of observations) {
    const id = observation.razorpayPaymentId;
    if (id === null || id === '') {
      unkeyed.push(observation);
      continue;
    }

    const existing = byPayment.get(id);
    if (existing === undefined) {
      byPayment.set(id, observation);
      continue;
    }

    byPayment.set(id, {
      ...existing,
      at: Math.min(existing.at, observation.at),
      outcome:
        OUTCOME_RANK[observation.outcome] > OUTCOME_RANK[existing.outcome]
          ? observation.outcome
          : existing.outcome,
      // A decline reason only exists on the failure, and is worth keeping when a later event
      // supersedes the outcome — it is how a recovery is explained.
      errorReason: existing.errorReason ?? observation.errorReason,
      errorSource: existing.errorSource ?? observation.errorSource,
    });
  }

  return [...byPayment.values(), ...unkeyed].sort((a, b) => a.at - b.at);
}

/** What a decision can act on. Containment applies to one of these, so features key on them. */
export type EntityKind = 'session' | 'device' | 'network';

export interface FeatureWindow {
  /** Everything older than this contributes almost nothing once decayed. */
  windowMs: number;
  halfLifeMs: number;
}

export const DEFAULT_WINDOW: FeatureWindow = {
  windowMs: minutes(30),
  halfLifeMs: minutes(5),
};

export interface FeatureVector {
  entityKind: EntityKind;
  entityKey: string;
  asOf: number;
  window: FeatureWindow;

  /** How hard this entity is trying. Decayed, so a burst that stopped decays away. */
  attemptRate: number;
  failureRate: number;

  /**
   * Distinct cards, estimated by sketch and confirmed exactly.
   *
   * The single most discriminating count in the corpus: enumeration walks many cards, dunning
   * hammers a few, and both produce a similar number of failures.
   */
  distinctCards: DistinctEstimate;
  distinctSessions: DistinctEstimate;
  distinctNetworks: DistinctEstimate;

  /** Undecayed counts over the window, for anything that must be exact. */
  attempts: number;
  failures: number;

  /** Captured over attempted. Attacks live far below anything honest traffic reaches. */
  approvalRate: number;

  /**
   * Share of failures Razorpay attributed to the gateway.
   *
   * The outage discriminator. An acquirer falling over produces gateway errors across
   * unrelated shoppers; enumeration produces card-validity failures concentrated in one. Both
   * produce a great many failures, and nothing else in the vector separates them.
   *
   * `bank` is deliberately *not* counted, though it sounds like infrastructure. Razorpay
   * attributes an issuer declining a card to the bank, so `bank` is what enumeration produces
   * — it is the majority source in every attack scenario in the corpus, and counting it here
   * made this feature read near 1.0 for a dunning run. Only `gateway` names a component that
   * failed rather than a card that was refused.
   */
  infrastructureFailureShare: number;

  /** How concentrated the decline reasons are. One repeated reason suggests one cause. */
  reasonConcentration: number;

  medianAmountPaise: number | null;
  /** Share of attempts at trivial amounts, the probe signature. */
  smallAmountShare: number;

  /**
   * Coefficient of variation of the gaps between attempts.
   *
   * Near zero is a machine on a timer. Around one is the exponential spacing independent
   * arrivals produce. A retry schedule and a script both sit low, which is why this cannot be
   * read alone.
   */
  burstiness: number;

  /**
   * Share of orders that failed and were then paid.
   *
   * The mitigating feature, and the one that keeps the system from accusing customers. A
   * declined shopper who pays is not an attacker, and without this the two are the same shape.
   */
  recoveryRate: number;
  /** Orders where a failure was followed by a capture. */
  recoveredOrders: number;

  /**
   * The newest observation this entity contributed, or null if it contributed none.
   *
   * Freshness, stated rather than implied. A vector computed as of a moment says nothing about
   * whether anything actually happened near that moment, and a reader looking at a high
   * attempt rate deserves to know whether it is happening now or finished an hour ago.
   */
  lastSeenAt: number | null;
}

function keyOf(observation: Observation, kind: EntityKind): string | null {
  if (kind === 'session') return observation.sessionPseudonym;
  if (kind === 'device') return observation.devicePseudonym;
  return observation.ipPseudonym;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/**
 * Herfindahl concentration: 1 when every value is the same, approaching 0 when they are
 * evenly spread. Chosen over entropy because it is bounded and reads the same way at every
 * cardinality, which matters when the same threshold has to hold for three failures and three
 * hundred.
 */
function concentration(values: readonly string[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  let sum = 0;
  for (const count of counts.values()) sum += (count / values.length) ** 2;
  return sum;
}

/** Coefficient of variation of inter-arrival gaps. */
function burstinessOf(times: readonly number[]): number {
  if (times.length < 3) return 0;
  const sorted = [...times].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) gaps.push(sorted[i]! - sorted[i - 1]!);

  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean === 0) return 0;

  const variance = gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Orders where a failure was followed by a capture.
 *
 * Computed over orders rather than payments because that is where a recovery lives: the
 * shopper retries and Razorpay issues a second payment id, so no single payment ever shows
 * both outcomes.
 */
function recoveries(observations: readonly Observation[]): { orders: number; recovered: number } {
  const byOrder = new Map<string, { failed: boolean; settled: boolean }>();

  for (const observation of observations) {
    const existing = byOrder.get(observation.razorpayOrderId) ?? { failed: false, settled: false };
    if (observation.outcome === 'failed') existing.failed = true;
    if (observation.outcome === 'captured') existing.settled = true;
    byOrder.set(observation.razorpayOrderId, existing);
  }

  let recovered = 0;
  for (const order of byOrder.values()) if (order.failed && order.settled) recovered += 1;
  return { orders: byOrder.size, recovered };
}

function sketchOf(values: readonly (string | null)[]): { sketch: HyperLogLog; exact: number } {
  const sketch = new HyperLogLog();
  const seen = new Set<string>();

  for (const value of values) {
    if (value === null) continue;
    sketch.add(value);
    seen.add(value);
  }

  return { sketch, exact: seen.size };
}

/**
 * Computes every feature for one entity, as of one moment.
 *
 * Pure, and `asOf` is explicit rather than read from a clock: a decision has to be
 * reproducible, and a function that asks the system what time it is cannot be replayed.
 * Observations after `asOf` are dropped, so a replay sees exactly what the original saw.
 *
 * `confirmExact` is on by default and controls whether the sketch estimates are backed by a
 * real count. Turning it off is the candidate-discovery path — cheap, approximate, and never
 * the basis of a decision.
 */
export function computeFeatures(
  entityKind: EntityKind,
  entityKey: string,
  all: readonly Observation[],
  asOf: number,
  window: FeatureWindow = DEFAULT_WINDOW,
  confirmExact = true,
): FeatureVector {
  const from = asOf - window.windowMs;
  const observations = perPayment(all).filter(
    (o) => keyOf(o, entityKind) === entityKey && o.at <= asOf && o.at >= from,
  );

  const times = observations.map((o) => o.at);
  const failures = observations.filter((o) => o.outcome === 'failed');
  const captures = observations.filter((o) => o.outcome === 'captured');

  const cards = sketchOf(observations.map((o) => o.cardId));
  const sessions = sketchOf(observations.map((o) => o.sessionPseudonym));
  const networks = sketchOf(observations.map((o) => o.ipPseudonym));

  const withExact = (counted: { sketch: HyperLogLog; exact: number }): DistinctEstimate => ({
    ...estimateDistinct(counted.sketch),
    exact: confirmExact ? counted.exact : null,
  });

  const infrastructure = failures.filter((o) => o.errorSource === 'gateway');
  const amounts = observations
    .map((o) => o.amountPaise)
    .filter((amount): amount is number => amount !== null);

  const { orders, recovered } = recoveries(observations);
  const windowMinutes = window.windowMs / 60_000;

  return {
    entityKind,
    entityKey,
    asOf,
    window,

    attemptRate: decayedCount(times, asOf, window.halfLifeMs) / windowMinutes,
    failureRate:
      decayedCount(
        failures.map((o) => o.at),
        asOf,
        window.halfLifeMs,
      ) / windowMinutes,

    distinctCards: withExact(cards),
    distinctSessions: withExact(sessions),
    distinctNetworks: withExact(networks),

    attempts: observations.length,
    failures: failures.length,
    approvalRate: observations.length === 0 ? 0 : captures.length / observations.length,

    infrastructureFailureShare: failures.length === 0 ? 0 : infrastructure.length / failures.length,
    reasonConcentration: concentration(failures.map((o) => o.errorReason ?? 'unknown')),

    medianAmountPaise: median(amounts),
    smallAmountShare:
      amounts.length === 0 ? 0 : amounts.filter((a) => a <= 5_000).length / amounts.length,

    burstiness: burstinessOf(times),

    recoveryRate: orders === 0 ? 0 : recovered / orders,
    recoveredOrders: recovered,

    lastSeenAt: times.length === 0 ? null : Math.max(...times),
  };
}
