import { z } from 'zod';
import { incidentSummarySchema } from './incident.js';

export const overviewEventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  orderId: z.string().nullable(),
  paymentId: z.string().nullable(),
  status: z.string().nullable(),
  amountPaise: z.number().int().nullable(),
  eventAt: z.string().datetime(),
  risk: z.number().min(0).max(1),
  riskBasis: z.enum(['payment-outcome', 'incident', 'unassessed']),
});

export const overviewTrendPointSchema = z.object({
  at: z.string().datetime(),
  events: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  risk: z.number().min(0).max(1),
});

export const overviewResponseSchema = z.object({
  window: z.enum(['today', '24h', '7d']),
  generatedAt: z.string().datetime(),
  source: z.literal('razorpay'),
  eventsAnalyzed: z.number().int().nonnegative(),
  attemptsToday: z.number().int().nonnegative(),
  paymentsCaptured: z.number().int().nonnegative(),
  paymentsFailed: z.number().int().nonnegative(),
  activeIncidents: z.number().int().nonnegative(),
  underReview: z.number().int().nonnegative(),
  contained: z.number().int().nonnegative(),
  totalIncidents: z.number().int().nonnegative(),
  safe: z.number().int().nonnegative(),
  risk: z.number().min(0).max(1).nullable(),
  riskLevel: z.enum(['low', 'medium', 'high']).nullable(),
  riskTrend: z.array(overviewTrendPointSchema),
  recentEvents: z.array(overviewEventSchema),
  topRiskReasons: z.array(z.object({ code: z.string(), count: z.number().int().positive() })),
  recentIncidents: z.array(incidentSummarySchema),
});

export type OverviewResponse = z.infer<typeof overviewResponseSchema>;
