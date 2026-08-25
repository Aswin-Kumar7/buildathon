import { z } from 'zod';

/**
 * What the system health page reads.
 *
 * `configured` is first for a reason: every other number on this page is zero both when
 * ingestion is healthy and idle, and when the webhook was never set up. A dashboard that
 * cannot tell those apart reports "all quiet" during an outage.
 */
export const ingestionMetricsSchema = z.object({
  configured: z.boolean(),

  eventsStored: z.number().int().nonnegative(),
  canonicalEvents: z.number().int().nonnegative(),

  duplicateDeliveries: z.number().int().nonnegative(),
  duplicateRate: z.number().min(0).max(1),

  eventsPerMinute: z.number().nonnegative(),
  pendingDepth: z.number().int().nonnegative(),
  deadLetterDepth: z.number().int().nonnegative(),
  lateEvents: z.number().int().nonnegative(),

  lastEventReceivedAt: z.string().datetime().nullable(),
  oldestPendingAgeMs: z.number().nonnegative().nullable(),
  meanProcessingMs: z.number().nullable(),

  watermark: z.string().datetime().nullable(),
  allowedLatenessMinutes: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
});
export type IngestionMetrics = z.infer<typeof ingestionMetricsSchema>;

/** Razorpay only needs a 2xx; the body is for our own logs and tests. */
export const webhookAckSchema = z.object({
  received: z.literal(true),
  /** False when this delivery was a repeat of an event already stored. */
  stored: z.boolean(),
  late: z.boolean(),
});
export type WebhookAck = z.infer<typeof webhookAckSchema>;
