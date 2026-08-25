/**
 * Grouping rule firings into incidents, and the lifecycle one moves through.
 *
 * The unit an analyst works is an incident, not an alert. A burst of sixty attempts that
 * produced sixty alerts would be a worse product than one that produced none — the analyst
 * would still have to reconstruct that they were all the same thing, and would do it by hand,
 * under time pressure, sixty times. So activity from one entity that keeps going is one
 * incident that keeps being updated.
 *
 * The lifecycle is explicit and its transitions are checked, for the same reason the payment
 * state machine's are. "Contained" and "resolved" are claims about what somebody did; a system
 * that let an incident slide between them without saying who or when could not answer the only
 * question that matters afterwards, which is why it was closed.
 *
 * Everything here is pure. Persistence, and who is allowed to move an incident, belong to the
 * API — but what a legal move *is* belongs with the rules that opened it.
 */

import type { ChangeResult } from './changepoint.js';
import type { FeatureVector } from './features.js';
import type { RuleId, RuleOutcome } from './rules.js';
import { scoreOutcomes, type Score } from './score.js';
import { THRESHOLDS, type Thresholds } from './thresholds.js';

export type IncidentStatus = 'open' | 'under_review' | 'contained' | 'resolved' | 'expired';

export type Severity = 'low' | 'medium' | 'high';

/**
 * Where an incident may go from where it is.
 *
 * `resolved` and `expired` are terminal: an incident that was closed and then reopened is a
 * new incident, because the alternative is a record whose history can be rewritten. `contained`
 * can still be resolved, which is what happens when the containment worked, or reviewed again,
 * which is what happens when it did not.
 */
const TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  open: ['under_review', 'contained', 'resolved', 'expired'],
  under_review: ['contained', 'resolved', 'expired'],
  contained: ['under_review', 'resolved'],
  resolved: [],
  expired: [],
};

export interface Incident {
  /** Deterministic, so the same events produce the same incident on a replay. */
  key: string;
  entityKind: FeatureVector['entityKind'];
  entityKey: string;

  status: IncidentStatus;
  severity: Severity;
  score: Score;

  /** The earliest attempt that contributed. Time-to-detect is measured from here. */
  firstAttemptAt: number;
  /** When the rules first had enough to open it. */
  detectedAt: number;
  /** The newest attempt folded in. Expiry is measured from here. */
  lastActivityAt: number;
  expiresAt: number;

  /** How many evaluations have been folded in. One burst, many updates, one incident. */
  observations: number;
  /** Attempts in the window this was judged on. Two entity kinds seeing the same number over
   * the same span are seeing the same attempts, which is how a duplicate is recognised. */
  attempts: number;
  change: ChangeResult | null;
}

/**
 * Whether two incidents describe the same attempts seen through different correlation keys.
 *
 * One machine has one session, one device and one network, so evaluating all three kinds
 * produces three incidents for one burst — three rows an analyst has to work out are the same
 * thing. Identical span and identical attempt count is not a heuristic here: it means the same
 * attempts were counted twice, once per key.
 */
export const describesSameActivity = (a: Incident, b: Incident): boolean =>
  a.firstAttemptAt === b.firstAttemptAt &&
  a.lastActivityAt === b.lastActivityAt &&
  a.attempts === b.attempts;

/** Narrowest first. Containment applies to the most specific entity that explains the activity. */
export const ENTITY_SPECIFICITY: Record<Incident['entityKind'], number> = {
  session: 0,
  device: 1,
  network: 2,
};

/** Milliseconds between the first attempt and the moment the rules could act on it. */
export const timeToDetect = (incident: Incident): number =>
  Math.max(incident.detectedAt - incident.firstAttemptAt, 0);

export function severityOf(score: Score, thresholds: Thresholds = THRESHOLDS): Severity {
  if (score.value >= thresholds.severityHigh) return 'high';
  if (score.value >= thresholds.severityMedium) return 'medium';
  return 'low';
}

/**
 * Rules capable of establishing that traffic is an attack, rather than merely that it failed.
 *
 * `approval_collapse` and `reason_mix` say a lot of attempts failed and failed the same way.
 * That is true of enumeration and equally true of a subscription biller working through cards
 * that are out of money — so on their own they describe a bad afternoon, not an adversary. The
 * rules here describe *how the traffic behaves*: a list of cards being walked, a rate no person
 * produces, amounts chosen to be cheap, arrivals on a timer.
 *
 * A dunning storm seen through a thirty-minute window is what forced the distinction. Eight
 * cards over fourteen attempts is not enough reuse to trigger the mitigation and not enough
 * spread to trigger the accusation, and the two failure rules alone carried it over the floor.
 * The system would have told a merchant that collecting its own money was an incident.
 */
const DISCRIMINATING: readonly RuleId[] = [
  'card_spread',
  'velocity',
  'small_amount_probing',
  'machine_cadence',
];

/**
 * Whether this evaluation is worth opening an incident over.
 *
 * Three conditions, and each rules out a different way of being wrong. The score has to clear
 * the floor. The band has to be narrow enough that the score means something — a 0.5 that could
 * be anywhere between 0.2 and 0.7 because half the rules abstained is not the same claim as a
 * confident 0.5. And something must have been observed that an attack explains better than bad
 * luck does.
 */
export function warrantsIncident(score: Score, thresholds: Thresholds = THRESHOLDS): boolean {
  if (score.value < thresholds.incidentFloor || score.band === 'low') return false;

  return score.evidence.some((item) => item.weight > 0 && DISCRIMINATING.includes(item.rule));
}

/**
 * A stable identity for the incident an entity's activity belongs to.
 *
 * Keyed on the entity and the moment its activity started, not on wall-clock time, so replaying
 * the same events reproduces the same key. That is what makes an incident citable later.
 */
export const incidentKey = (
  entityKind: string,
  entityKey: string,
  firstAttemptAt: number,
): string => `${entityKind}:${entityKey}:${firstAttemptAt}`;

export interface OpenOptions {
  outcomes: readonly RuleOutcome[];
  vector: FeatureVector;
  /** The decision moment. Explicit, never a clock read, so an incident can be reproduced. */
  at: number;
  change?: ChangeResult;
  thresholds?: Thresholds;
}

export function openIncident({
  outcomes,
  vector,
  at,
  change,
  thresholds = THRESHOLDS,
}: OpenOptions): Incident {
  const score = scoreOutcomes(outcomes);
  const firstAttemptAt = vector.lastSeenAt ?? at;

  return {
    key: incidentKey(vector.entityKind, vector.entityKey, firstAttemptAt),
    entityKind: vector.entityKind,
    entityKey: vector.entityKey,
    status: 'open',
    severity: severityOf(score, thresholds),
    score,
    firstAttemptAt,
    detectedAt: at,
    lastActivityAt: vector.lastSeenAt ?? at,
    expiresAt: (vector.lastSeenAt ?? at) + thresholds.incidentIdleMs,
    observations: 1,
    attempts: vector.attempts,
    change: change ?? null,
  };
}

/**
 * Folds a fresh evaluation of the same entity into an existing incident.
 *
 * The score is replaced rather than accumulated. An incident describes what is true *now*,
 * and a score that only ever grew would mean an attacker who stopped stayed guilty — while
 * mitigating evidence arriving late, which is exactly when a recovery arrives, could never
 * bring it down.
 *
 * `firstAttemptAt` and `detectedAt` never move, because time-to-detect is a fact about this
 * incident that later activity cannot change.
 */
export function foldInto(
  incident: Incident,
  outcomes: readonly RuleOutcome[],
  vector: FeatureVector,
  at: number,
  change?: ChangeResult,
  thresholds: Thresholds = THRESHOLDS,
): Incident {
  const score = scoreOutcomes(outcomes);
  const lastActivityAt = Math.max(incident.lastActivityAt, vector.lastSeenAt ?? at);

  return {
    ...incident,
    score,
    severity: severityOf(score, thresholds),
    lastActivityAt,
    expiresAt: lastActivityAt + thresholds.incidentIdleMs,
    observations: incident.observations + 1,
    attempts: vector.attempts,
    change: change ?? incident.change,
  };
}

/**
 * Whether new activity belongs to this incident or starts another.
 *
 * One idle window of silence ends it. Anything shorter is the same episode seen again; anything
 * longer is a separate thing that happens to involve the same entity, and merging those would
 * produce an incident that never closes and means nothing.
 */
export function belongsTo(incident: Incident, activityAt: number): boolean {
  if (incident.status === 'resolved' || incident.status === 'expired') return false;
  return activityAt <= incident.expiresAt;
}

export class InvalidTransition extends Error {
  constructor(
    readonly from: IncidentStatus,
    readonly to: IncidentStatus,
  ) {
    super(`an incident cannot go from ${from} to ${to}`);
    this.name = 'InvalidTransition';
  }
}

/** Moves an incident, or refuses. Refusing loudly is the point. */
export function transition(incident: Incident, to: IncidentStatus, at: number): Incident {
  if (!TRANSITIONS[incident.status].includes(to)) {
    throw new InvalidTransition(incident.status, to);
  }
  return { ...incident, status: to, lastActivityAt: Math.max(incident.lastActivityAt, at) };
}

export const canTransition = (from: IncidentStatus, to: IncidentStatus): boolean =>
  TRANSITIONS[from].includes(to);

/**
 * Expires an incident nothing has happened on, or returns it unchanged.
 *
 * Automatic, and one-way. An incident that stays open forever because nobody got to it is how
 * a queue becomes something people stop opening — and an expired incident is still a record,
 * so nothing is lost by closing it.
 */
export function expireIfIdle(incident: Incident, now: number): Incident {
  if (incident.status === 'resolved' || incident.status === 'expired') return incident;
  if (now <= incident.expiresAt) return incident;
  return { ...incident, status: 'expired' };
}

/**
 * Clusters a stream of per-entity evaluations into incidents.
 *
 * Evaluations must arrive in time order. The exit condition for this slice is that a replayed
 * attack burst becomes exactly one incident, and this is where that happens: an entity already
 * inside an open incident's window folds into it, and only silence longer than the window
 * starts another.
 */
export interface Evaluation {
  vector: FeatureVector;
  outcomes: readonly RuleOutcome[];
  at: number;
  change?: ChangeResult;
}

export function clusterIncidents(
  evaluations: readonly Evaluation[],
  thresholds: Thresholds = THRESHOLDS,
): Incident[] {
  const open = new Map<string, Incident>();
  const closed: Incident[] = [];

  for (const evaluation of evaluations) {
    const { vector, outcomes, at, change } = evaluation;
    const identity = `${vector.entityKind}:${vector.entityKey}`;
    const existing = open.get(identity);
    const activityAt = vector.lastSeenAt ?? at;

    if (existing !== undefined && belongsTo(existing, activityAt)) {
      open.set(identity, foldInto(existing, outcomes, vector, at, change, thresholds));
      continue;
    }

    if (existing !== undefined) {
      closed.push(expireIfIdle(existing, activityAt));
      open.delete(identity);
    }

    // Only now decide whether there is anything worth opening. Checking earlier would let a
    // quiet evaluation of an entity already under investigation drop its incident on the floor.
    if (!warrantsIncident(scoreOutcomes(outcomes), thresholds)) continue;
    open.set(
      identity,
      openIncident({ outcomes, vector, at, ...(change && { change }), thresholds }),
    );
  }

  return [...closed, ...open.values()].sort((a, b) => a.detectedAt - b.detectedAt);
}

/** The rules that fired, for a compact summary in a queue row. */
export const firedRules = (incident: Incident): RuleId[] => [
  ...new Set(incident.score.evidence.filter((e) => e.weight > 0).map((e) => e.rule)),
];

/**
 * Drops incidents that are the same activity seen through a coarser correlation key.
 *
 * Keeps the narrowest, because that is where containment would apply: blocking one session is
 * a smaller act than blocking a network, and if the two describe identical attempts there is
 * no reason to reach for the larger one. When an attacker rotates sessions, the session-level
 * incidents never open and the network-level one survives on its own — which is the case this
 * must not break.
 */
export function dropDuplicateViews(incidents: readonly Incident[]): Incident[] {
  const kept: Incident[] = [];

  for (const incident of [...incidents].sort(
    (a, b) => ENTITY_SPECIFICITY[a.entityKind] - ENTITY_SPECIFICITY[b.entityKind],
  )) {
    if (kept.some((existing) => describesSameActivity(existing, incident))) continue;
    kept.push(incident);
  }

  return kept.sort((a, b) => a.detectedAt - b.detectedAt);
}
