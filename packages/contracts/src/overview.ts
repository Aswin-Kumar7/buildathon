import { z } from 'zod';
import { incidentSummarySchema } from './incident.js';

export const overviewTrendPointSchema = z.object({
  at: z.string().datetime(),
  events: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
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
