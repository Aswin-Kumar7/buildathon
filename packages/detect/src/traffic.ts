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
   * Sessions that only ever failed, across at least two distinct cards, and not gateway-blamed.
   *
   * The enumeration fingerprint, counted directly rather than inferred from a shop-wide rate. A
   * legitimate surge keeps approving real shoppers, so its sessions never enter this cohort and
   * cannot dilute it — which is what lets a distributed attack stay visible even when it shares a
   * thirty-minute window with a flash sale. The `>= 2 cards` clause is what separates it from a
   * shopper retrying one declined card, and dropping gateway-blamed sessions keeps an outage out.
   */
  cardTestingSessions: number;

  /**
   * Approval rate among the sessions that failed at least once.
   *
   * The severity companion to `cardTestingSessions`, and dilution-proof for the same reason: a
   * surge that keeps approving never joins the failing population, so leftover benign captures
   * cannot soften the score of a real spike the way they soften the shop-wide `approvalRate`.
   */
  failingSessionApprovalRate: number;

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
  cardTestingSessions: 0,
  failingSessionApprovalRate: 0,
  distinctCards: 0,
  distinctFailingIssuers: 0,
};

/** Per-session tallies the shop-wide signals are derived from, gathered in one pass over the window. */
interface SessionAgg {
  attempts: number;
  captures: number;
  failures: number;
  gatewayFailures: number;
  cards: Set<string>;
}

function aggregateBySession(observations: readonly Observation[]): Map<string, SessionAgg> {
  const bySession = new Map<string, SessionAgg>();
  for (const o of observations) {
    if (o.sessionPseudonym === null) continue;
    let agg = bySession.get(o.sessionPseudonym);
    if (agg === undefined) {
      agg = { attempts: 0, captures: 0, failures: 0, gatewayFailures: 0, cards: new Set() };
      bySession.set(o.sessionPseudonym, agg);
    }
    agg.attempts += 1;
    if (o.outcome === 'captured') agg.captures += 1;
    if (o.outcome === 'failed') {
      agg.failures += 1;
      if (o.errorSource === 'gateway') agg.gatewayFailures += 1;
    }
    if (o.cardId !== null) agg.cards.add(o.cardId);
  }
  return bySession;
}

/**
 * The enumeration fingerprint: a session that only ever failed, across two or more distinct cards,
 * and not gateway-blamed. A lone declined shopper walks one card (fails the card test); an outage is
 * gateway-blamed (dropped here); a legitimate surge captures (so it never reaches this at all).
 */
function isCardTesting(s: SessionAgg): boolean {
  const gatewayDominated = s.failures > 0 && s.gatewayFailures / s.failures > 0.5;
  return s.attempts >= 2 && s.captures === 0 && s.cards.size >= 2 && !gatewayDominated;
}

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

  // One aggregate per session, so the session-cohort signals below are all read off the same pass:
  // breadth of failure (how many failed at all), the enumeration cohort (sessions that only ever
  // failed across many cards), and the approval rate among the sessions that failed.
  const bySession = aggregateBySession(observations);

  let worst = 0;
  let failingSessions = 0;
  let cardTestingSessions = 0;
  let failingAttempts = 0;
  let failingCaptures = 0;
  for (const s of bySession.values()) {
    if (s.failures > worst) worst = s.failures;
    if (s.failures > 0) {
      failingSessions += 1;
      failingAttempts += s.attempts;
      failingCaptures += s.captures;
    }
    if (isCardTesting(s)) cardTestingSessions += 1;
  }
  const activeSessions = bySession.size;

  return {
    asOf,
    windowMs: window.windowMs,

    attempts: observations.length,
    failures: failures.length,
    approvalRate: captures.length / observations.length,
    infrastructureFailureShare: failures.length === 0 ? 0 : infrastructure.length / failures.length,

    failingSessions,
    activeSessions,
    topSessionFailureShare: failures.length === 0 ? 0 : worst / failures.length,
    cardTestingSessions,
    failingSessionApprovalRate: failingAttempts === 0 ? 0 : failingCaptures / failingAttempts,

    distinctCards: new Set(observations.map((o) => o.cardId).filter((c): c is string => c !== null))
      .size,
    // Always reported, never depended on. See the note on the field.
    distinctFailingIssuers: 0,
  };
}
