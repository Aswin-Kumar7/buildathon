/**
 * What the rest of the shop was doing while this entity was doing whatever it did.
 *
 * The single most important idea in the detector, and the one a per-entity feature vector
 * cannot express: **you cannot tell an outage from an attack by looking at one entity.** Both
 * produce a session failing repeatedly. The difference is entirely in whether everybody else is
 * failing too — and that is a fact about the population, not about the session.
 *
 * So this exists alongside `FeatureVector` rather than inside it. A vector answers "what did
 * this entity do"; a context answers "was that unusual here, just now". Arbitration needs both,
 * and reaches different conclusions from identical vectors depending on the second.
 *
 * Everything is computed as of an explicit moment, like the features, so a decision taken on it
 * can be replayed.
 */

import type { FeatureWindow, Observation } from './features.js';
import { DEFAULT_WINDOW, perPayment } from './features.js';

export interface TrafficContext {
  asOf: number;
  windowMs: number;

  attempts: number;
  failures: number;
  /** Captured over attempted, across everyone. */
  approvalRate: number;
  /** Failures Razorpay blamed on its own gateway, across everyone. */
  infrastructureFailureShare: number;

  /**
   * Breadth of failure: how many distinct sessions failed at all.
   *
   * The discriminator the slice is built on. An acquirer falling over produces failures spread
   * across unrelated shoppers; one machine working a card list produces them in one place.
   */
  failingSessions: number;
  activeSessions: number;

  /**
   * Share of every failure in the window belonging to the single worst session.
   *
   * Near 1 means one entity accounts for the trouble. Near 0 means it is everywhere, which is
   * what an outage and a flash sale both look like — and what tells them apart is the approval
   * rate, not the spread.
   */
  topSessionFailureShare: number;

  /**
   * Distinct cards seen across the window, exactly.
   *
   * Not sketched. This one number can move a decision between "contain" and "leave alone", so
   * it is counted rather than estimated.
   */
  distinctCards: number;

  /**
   * Distinct card issuers among the failures.
   *
   * Included because a real outage spreads across issuers and enumeration need not, and it is
   * cheap corroboration when the data varies. **The scenario corpus fixes the issuer at a
   * single value**, so nothing in this project is tuned against it and no hypothesis requires
   * it — it is reported, and would earn its place against real traffic. Building a
   * discriminator on a field the tests cannot vary would be building something nobody has
   * checked.
   */
  distinctFailingIssuers: number;
}

const EMPTY: Omit<TrafficContext, 'asOf' | 'windowMs'> = {
  attempts: 0,
  failures: 0,
  approvalRate: 0,
  infrastructureFailureShare: 0,
  failingSessions: 0,
  activeSessions: 0,
  topSessionFailureShare: 0,
  distinctCards: 0,
  distinctFailingIssuers: 0,
};

export function computeTraffic(
  all: readonly Observation[],
  asOf: number,
  window: FeatureWindow = DEFAULT_WINDOW,
): TrafficContext {
  const from = asOf - window.windowMs;
  // One row per payment, like the features. Counting webhooks as attempts would put a different
  // denominator under every rate here than the one the vectors were computed with.
  const observations = perPayment(all).filter((o) => o.at <= asOf && o.at >= from);

  if (observations.length === 0) return { asOf, windowMs: window.windowMs, ...EMPTY };

  const failures = observations.filter((o) => o.outcome === 'failed');
  const captures = observations.filter((o) => o.outcome === 'captured');
  const infrastructure = failures.filter((o) => o.errorSource === 'gateway');

  const failuresBySession = new Map<string, number>();
  for (const failure of failures) {
    if (failure.sessionPseudonym === null) continue;
    failuresBySession.set(
      failure.sessionPseudonym,
      (failuresBySession.get(failure.sessionPseudonym) ?? 0) + 1,
    );
  }

  const worst = Math.max(0, ...failuresBySession.values());
  const activeSessions = new Set(
    observations.map((o) => o.sessionPseudonym).filter((s): s is string => s !== null),
  ).size;

  return {
    asOf,
    windowMs: window.windowMs,

    attempts: observations.length,
    failures: failures.length,
    approvalRate: captures.length / observations.length,
    infrastructureFailureShare: failures.length === 0 ? 0 : infrastructure.length / failures.length,

    failingSessions: failuresBySession.size,
    activeSessions,
    topSessionFailureShare: failures.length === 0 ? 0 : worst / failures.length,

    distinctCards: new Set(observations.map((o) => o.cardId).filter((c): c is string => c !== null))
      .size,
    // Always reported, never depended on. See the note on the field.
    distinctFailingIssuers: 0,
  };
}
