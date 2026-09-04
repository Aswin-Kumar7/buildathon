import { z } from 'zod';

export const attemptStatusSchema = z.enum([
  'created',
  'failed',
  'authorized',
  'captured',
  'refunded',
]);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

export const attemptFailureSchema = z.object({
  code: z.string().nullable(),
  reason: z.string().nullable(),
  source: z.string().nullable(),
  step: z.string().nullable(),
  description: z.string().nullable(),
});

export const resolvedAttemptSchema = z.object({
  razorpayPaymentId: z.string(),
  status: attemptStatusSchema,
  amountPaise: z.number().int().nullable(),
  method: z.string().nullable(),
  cardNetwork: z.string().nullable(),
  cardIssuer: z.string().nullable(),
  /**
   * A short fingerprint of the card's token id — the same eight characters the incident graph shows,
   * never the card number and never its last four (which the canonical layer deliberately drops).
   * Null for non-card methods or when the token was not present.
   */
  cardFingerprint: z.string().nullable(),
  /** Present whenever the attempt was ever seen to fail, even if it later succeeded. */
  failure: attemptFailureSchema.nullable(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  eventCount: z.number().int().positive(),
  late: z.boolean(),
});
export type ResolvedAttempt = z.infer<typeof resolvedAttemptSchema>;

/**
 * The request context recorded when the order was created, reduced to something a person can
 * compare at a glance.
 *
 * These are the first eight characters of a keyed hash, not the hash itself and certainly not
 * the value behind it. Enough to see that two orders came from the same session; not enough
 * to be an identifier in its own right.
 */
export const sensorContextSchema = z.object({
  sessionFingerprint: z.string(),
  deviceFingerprint: z.string(),
  ipFingerprint: z.string(),
  userAgentFamily: z.string(),
  itemCount: z.number().int(),
  createdAt: z.string().datetime(),
});
export type SensorContext = z.infer<typeof sensorContextSchema>;

export const resolvedOrderSchema = z.object({
  razorpayOrderId: z.string(),
  source: z.enum(['razorpay', 'replay']),
  outcome: z.enum(['paid', 'failed', 'pending']),
  /**
   * A failure happened and the order was paid anyway.
   *
   * The field the console is built around: a shopper declined once who then paid is a
   * customer who had a bad minute, not an attacker. Collapsing that into "two failed
   * payments" is how a detector ends up accusing people of card testing for having a bank
   * that was briefly down.
   */
  recovered: z.boolean(),
  attempts: z.array(resolvedAttemptSchema),
  amountPaise: z.number().int().nullable(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  failureCount: z.number().int().nonnegative(),
  /** Absent when the order was created before the storefront recorded context, or elsewhere. */
  sensor: sensorContextSchema.nullable(),
});
export type ResolvedOrder = z.infer<typeof resolvedOrderSchema>;

/**
 * A checkout that was started and never reached a terminal payment event, past the point
 * where a late arrival would still be expected.
 *
 * Recorded rather than guessed at. The alternative — quietly assuming an unresolved checkout
 * failed — would invent failures that never happened, and card-testing detection keyed on
 * failure counts is exactly the wrong place to invent failures.
 */
export const unresolvedAttemptSchema = z.object({
  razorpayOrderId: z.string(),
  amountPaise: z.number().int(),
  createdAt: z.string().datetime(),
  ageMinutes: z.number().nonnegative(),
  sensor: sensorContextSchema.nullable(),
});
export type UnresolvedAttempt = z.infer<typeof unresolvedAttemptSchema>;

export const ordersResponseSchema = z.object({
  orders: z.array(resolvedOrderSchema),
  unresolved: z.array(unresolvedAttemptSchema),
  allowedLatenessMinutes: z.number().int().nonnegative(),
});
export type OrdersResponse = z.infer<typeof ordersResponseSchema>;

export const orderDetailResponseSchema = z.object({
  order: resolvedOrderSchema,
});
export type OrderDetailResponse = z.infer<typeof orderDetailResponseSchema>;

/**
 * One row of the flat attempts table: a single resolved payment attempt and the incident it
 * belongs to (if any).
 *
 * There is deliberately no per-attempt risk score or level. A single attempt is never risky or
 * safe on its own — risk is a property of a correlated incident, formed only once many attempts
 * and behavioural factors line up. The only risk signal a row carries is a factual link to the
 * incident it fell inside, if one exists.
 */
export const attemptRowStatusSchema = z.enum([
  'captured',
  'failed',
  'recovered',
  'authorized',
  'refunded',
  'pending',
]);
export type AttemptRowStatus = z.infer<typeof attemptRowStatusSchema>;

export const attemptRowSchema = z.object({
  /** The payment id doubles as the attempt id — Razorpay has no attempt id above the payment. */
  paymentId: z.string(),
  orderId: z.string(),
  amountPaise: z.number().int().nullable(),
  method: z.string().nullable(),
  cardNetwork: z.string().nullable(),
  status: attemptRowStatusSchema,
  source: z.enum(['razorpay', 'replay']),
  /** The incident whose correlated entity and window this attempt falls inside, or null. */
  incidentId: z.string().nullable(),
  /** A short, stable display reference for that incident (a formatting of its id, not a new id). */
  incidentRef: z.string().nullable(),
  /** The incident's human title (e.g. "Coordinated card testing"), or null when part of none. */
  incidentTitle: z.string().nullable(),
  /**
   * The severity of the incident this attempt belongs to, or null when it belongs to none.
   *
   * This is not a risk score for the attempt — there is no such thing, and inventing one is what
   * this table deliberately refuses to do. It is the incident's own severity, carried onto its
   * attempts so the table can be filtered by it honestly.
   */
  incidentSeverity: z.enum(['low', 'medium', 'high']).nullable(),
  at: z.string().datetime(),
});
export type AttemptRow = z.infer<typeof attemptRowSchema>;

export const attemptKpisSchema = z.object({
  total: z.number().int().nonnegative(),
  captured: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  recovered: z.number().int().nonnegative(),
  /** Attempts that currently fall inside a detected incident — the only risk-shaped count there is. */
  inIncident: z.number().int().nonnegative(),
});
export type AttemptKpis = z.infer<typeof attemptKpisSchema>;

export const attemptRowsResponseSchema = z.object({
  rows: z.array(attemptRowSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  /** Rows matching the active filters, across all pages. */
  total: z.number().int().nonnegative(),
  /** KPI counts over the whole scoped set (the current source), before filters or paging. */
  kpis: attemptKpisSchema,
  source: z.enum(['razorpay', 'replay', 'all']),
});
export type AttemptRowsResponse = z.infer<typeof attemptRowsResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * Payment attempt detail
 *
 * Everything a merchant needs to understand what happened to one payment, and whether it has
 * become part of a correlated incident. Nothing here is a per-attempt fraud score: the attempt is
 * described by what was observed, and the only risk verdict comes from the incident it belongs to.
 * ---------------------------------------------------------------------------------------------- */

/** The payment itself, as resolved from its canonical events. */
export const attemptDetailPaymentSchema = z.object({
  paymentId: z.string(),
  orderId: z.string().nullable(),
  amountPaise: z.number().int().nullable(),
  currency: z.string().nullable(),
  method: z.string().nullable(),
  status: attemptStatusSchema,
  captured: z.boolean(),
  refunded: z.boolean(),
  /**
   * Coarse card cohort only. The card's last four is deliberately never stored — for a tokenised
   * card it is the token's last four, not the card's, so it would identify a person without even
   * being the signal it looks like. The card is identified here by a short fingerprint of its
   * token id, which is what "distinct cards" is actually counted on.
   */
  cardNetwork: z.string().nullable(),
  cardType: z.string().nullable(),
  cardIssuer: z.string().nullable(),
  cardFingerprint: z.string().nullable(),
  international: z.boolean().nullable(),
  failure: attemptFailureSchema.nullable(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  eventCount: z.number().int().positive(),
  late: z.boolean(),
  source: z.enum(['razorpay', 'replay']),
});
export type AttemptDetailPayment = z.infer<typeof attemptDetailPaymentSchema>;

/** The incident this attempt currently falls inside, described as a relationship, not a score. */
export const attemptIncidentLinkSchema = z.object({
  id: z.string(),
  ref: z.string(),
  title: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  status: z.string(),
  /** How the attempt was grouped: entity kind plus the plain-language reason it correlated. */
  entityKind: z.enum(['session', 'device', 'network']),
  reason: z.string(),
  attempts: z.number().int().nonnegative(),
  distinctCards: z.number().int().nonnegative().nullable(),
  distinctDevices: z.number().int().nonnegative(),
  distinctSessions: z.number().int().nonnegative(),
  windowMs: z.number().int().nonnegative(),
});
export type AttemptIncidentLink = z.infer<typeof attemptIncidentLinkSchema>;

/**
 * What was observed around this attempt at the moment it happened — not a verdict on it.
 *
 * Every value is a real count or comparison over the attempt's own device and network in a window
 * ending at its event time. Null for the whole block when the attempt has no checkout context to
 * observe from (a webhook that arrived without its matching session), because inventing zeroes
 * there would read as "nothing was happening" when the truth is "we could not see".
 */
export const attemptSignalsSchema = z.object({
  observedAt: z.string().datetime(),
  windowSeconds: z.number().int().positive(),
  /** Distinct payment attempts from this device inside the trailing window (velocity). */
  attemptsInWindow: z.number().int().nonnegative(),
  failuresInWindow: z.number().int().nonnegative(),
  /** failuresInWindow / attemptsInWindow, or null when the window held nothing to divide by. */
  failureRate: z.number().nullable(),
  /** Whether this device was already active before the trailing window began. */
  deviceSeenBefore: z.boolean(),
  /** Distinct devices seen on this network in a wider window — the honest network-sharing signal. */
  networkDistinctDevices: z.number().int().nonnegative(),
  networkWindowSeconds: z.number().int().positive(),
  /** Times this exact card was tried in the trailing window; null when the attempt used no card. */
  cardReuseInWindow: z.number().int().nonnegative().nullable(),
  /** This amount against the shop's own recent typical, or unknown when there is too little history. */
  amountVsTypical: z.enum(['typical', 'above', 'below', 'unknown']),
  typicalAmountPaise: z.number().int().nullable(),
});
export type AttemptSignals = z.infer<typeof attemptSignalsSchema>;

/** A neighbouring attempt from the same device, for the "recent from this device" panel. */
export const attemptDeviceRecentSchema = z.object({
  paymentId: z.string(),
  at: z.string().datetime(),
  amountPaise: z.number().int().nullable(),
  /** Card / UPI / netbanking / wallet, so the row can show the method's own mark. */
  method: z.string().nullable(),
  cardNetwork: z.string().nullable(),
  cardFingerprint: z.string().nullable(),
  status: attemptRowStatusSchema,
  isCurrent: z.boolean(),
});
export type AttemptDeviceRecent = z.infer<typeof attemptDeviceRecentSchema>;

export const attemptDetailSchema = z.object({
  payment: attemptDetailPaymentSchema,
  /** The storefront's record of who was checking out, or null when it was never captured. */
  context: sensorContextSchema.nullable(),
  incident: attemptIncidentLinkSchema.nullable(),
  signals: attemptSignalsSchema.nullable(),
  recentFromDevice: z.array(attemptDeviceRecentSchema),
  /** The canonical events for this payment exactly as stored — the redacted representation. */
  rawEvents: z.array(z.record(z.unknown())),
});
export type AttemptDetail = z.infer<typeof attemptDetailSchema>;

export const attemptDetailResponseSchema = z.object({
  attempt: attemptDetailSchema,
});
export type AttemptDetailResponse = z.infer<typeof attemptDetailResponseSchema>;
