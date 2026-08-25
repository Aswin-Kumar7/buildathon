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
