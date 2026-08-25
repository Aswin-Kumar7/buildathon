import { z } from 'zod';

/**
 * A count produced by a sketch, carrying its own uncertainty.
 *
 * `estimate` and `exact` are separate fields rather than one number and a flag, so no caller
 * can round-trip a sketch value into a place that expects an exact one. `exact` is null until
 * the confirmation path has re-derived it from the events, and a decision is only allowed to
 * rest on the confirmed figure.
 */
export const distinctEstimateSchema = z.object({
  estimate: z.number().int().nonnegative(),
  /** One standard error, in the same units as the estimate. */
  errorBound: z.number().int().nonnegative(),
  exact: z.number().int().nonnegative().nullable(),
});
export type DistinctEstimateDto = z.infer<typeof distinctEstimateSchema>;

export const featureWindowSchema = z.object({
  windowMs: z.number().int().positive(),
  halfLifeMs: z.number().int().positive(),
});

export const featureVectorSchema = z.object({
  entityKind: z.enum(['session', 'device', 'network']),
  entityKey: z.string(),
  /**
   * The moment the vector describes. Carried on the wire because a feature computed "now" is
   * not reproducible — replaying the same events against the same `asOf` has to give the same
   * numbers, or an explanation of a past decision is fiction.
   */
  asOf: z.number().int().nonnegative(),
  window: featureWindowSchema,

  attemptRate: z.number().nonnegative(),
  failureRate: z.number().nonnegative(),

  distinctCards: distinctEstimateSchema,
  distinctSessions: distinctEstimateSchema,
  distinctNetworks: distinctEstimateSchema,

  attempts: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),

  approvalRate: z.number().min(0).max(1),
  infrastructureFailureShare: z.number().min(0).max(1),
  reasonConcentration: z.number().min(0).max(1),
  /** Not integral: the median of an even number of amounts sits between two of them. */
  medianAmountPaise: z.number().nonnegative().nullable(),
  smallAmountShare: z.number().min(0).max(1),
  burstiness: z.number().nonnegative(),
  recoveryRate: z.number().min(0).max(1),
  recoveredOrders: z.number().int().nonnegative(),
  /** Newest observation from this entity. Null means it contributed nothing to the window. */
  lastSeenAt: z.number().int().nonnegative().nullable(),
});
export type FeatureVectorDto = z.infer<typeof featureVectorSchema>;

export const featureRankResponseSchema = z.object({
  /** How many entities were seen at all, so the reader knows what the list was drawn from. */
  candidates: z.number().int().nonnegative(),
  vectors: z.array(featureVectorSchema),
  asOf: z.number().int().nonnegative(),
  /** Real wall-clock time when the response was built, which `asOf` may deliberately differ from. */
  generatedAt: z.number().int().nonnegative(),
  newestObservationAt: z.number().int().nonnegative().nullable(),
  /**
   * Which moment `asOf` is.
   *
   * `now` is the normal case. `last-activity` means nothing happened recently enough to
   * compute anything, so the vectors describe the last moment something did — the honest
   * answer for a replayed scenario recorded months ago, and something the reader must be told
   * rather than left to infer from numbers that look live.
   */
  basis: z.enum(['now', 'last-activity']),
  /**
   * Which traffic the vectors were computed from.
   *
   * Real and replayed events are kept apart here for the same reason they are kept apart on
   * the health page: replayed traffic must never be countable as evidence the system works
   * against Razorpay. Merging them also breaks the window — the corpus carries timestamps from
   * months ago, so any live attempt anchors `asOf` to now and hides every replayed scenario.
   */
  source: z.enum(['razorpay', 'replay', 'all']),
});
export type FeatureRankResponse = z.infer<typeof featureRankResponseSchema>;

export const featureEntityResponseSchema = z.object({ vector: featureVectorSchema });
export type FeatureEntityResponse = z.infer<typeof featureEntityResponseSchema>;
