import { z } from 'zod';
import { incidentSummarySchema } from './incident.js';

export const overviewTrendPointSchema = z.object({
  at: z.string().datetime(),
  /** Payment attempts first seen in this bucket. */
  events: z.number().int().nonnegative(),
  /** How many of those attempts ended failed. Always a subset of `events`. */
  failures: z.number().int().nonnegative(),
  /** Incidents Sentinel raised in this bucket. */
  incidents: z.number().int().nonnegative(),
  /** The worst incident score in this bucket, or 0 when none was raised. */
  risk: z.number().min(0).max(1),
});

export const overviewResponseSchema = z.object({
  window: z.enum(['today', '24h', '7d', '30d']),
  generatedAt: z.string().datetime(),
  source: z.enum(['razorpay', 'replay', 'all']),
  eventsAnalyzed: z.number().int().nonnegative(),
  attemptsToday: z.number().int().nonnegative(),
  /** Fractional change in attempts vs the previous window, or null when there is no baseline. */
  attemptsDeltaPct: z.number().nullable(),
  paymentsCaptured: z.number().int().nonnegative(),
  paymentsFailed: z.number().int().nonnegative(),
  activeIncidents: z.number().int().nonnegative(),
  underReview: z.number().int().nonnegative(),
  contained: z.number().int().nonnegative(),
  totalIncidents: z.number().int().nonnegative(),
  resolvedToday: z.number().int().nonnegative(),
  safe: z.number().int().nonnegative(),
  risk: z.number().min(0).max(1).nullable(),
  riskLevel: z.enum(['low', 'medium', 'high']).nullable(),
  riskTrend: z.array(overviewTrendPointSchema),
  topRiskReasons: z.array(z.object({ code: z.string(), count: z.number().int().positive() })),
  recentIncidents: z.array(incidentSummarySchema),
});

export type OverviewResponse = z.infer<typeof overviewResponseSchema>;
