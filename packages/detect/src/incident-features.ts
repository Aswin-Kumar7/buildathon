/**
 * The feature vector the incident classifier (Model B) reads, computed once here.
 *
 * The training exporter and the request path both call this, so the model trains on exactly the
 * numbers it is later asked to score. The order is fixed and load-bearing: it is the feature order
 * the served weights are indexed by, and the Python side records a hash of these names as the
 * feature-definition version. Change the list or the order, and the model must be retrained.
 */

import type { FeatureVector } from './features.js';
import type { TrafficContext } from './traffic.js';

/** Fixed order. Must match `FEATURES` in the Python `incident.config`. */
export const INCIDENT_FEATURE_NAMES = [
  'log_attempts',
  'failure_rate',
  'approval_rate',
  'infra_share',
  'cards_per_attempt',
  'small_amount_share',
  'burstiness',
  'recovery_rate',
  'top_session_failure_share',
  'log_failing_sessions',
] as const;

export function incidentFeatures(vector: FeatureVector, traffic: TrafficContext): number[] {
  const cards = vector.distinctCards.exact ?? 0;
  return [
    Math.log1p(vector.attempts),
    vector.attempts === 0 ? 0 : vector.failures / vector.attempts,
    vector.approvalRate,
    traffic.infrastructureFailureShare,
    vector.attempts === 0 ? 0 : cards / vector.attempts,
    vector.smallAmountShare,
    vector.burstiness,
    vector.recoveryRate,
    traffic.topSessionFailureShare,
    Math.log1p(traffic.failingSessions),
  ];
}
