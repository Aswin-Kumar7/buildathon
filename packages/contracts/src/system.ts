import { z } from 'zod';

/**
 * System health under load — the live picture the console renders and the shape the performance
 * report is built from. Parsed on the way out like everything else.
 */

export const criticalitySchema = z.enum([
  'CRITICAL_PLUS',
  'CRITICAL',
  'SHEDDABLE_PLUS',
  'SHEDDABLE',
]);
export type CriticalityDto = z.infer<typeof criticalitySchema>;

/** The tail, never the average — the shape a latency SLO is actually judged on. */
export const percentilesSchema = z.object({
  count: z.number().int().nonnegative(),
  p50: z.number().nonnegative(),
  p95: z.number().nonnegative(),
  p99: z.number().nonnegative(),
  p999: z.number().nonnegative(),
  max: z.number().nonnegative(),
});
export type PercentilesDto = z.infer<typeof percentilesSchema>;

export const systemHealthSchema = z.object({
  /** The warm-path SLO the p99 is judged against, in milliseconds. */
  sloMs: z.number().positive(),
  /** Warm-path units executing right now. */
  inFlight: z.number().int().nonnegative(),
  /** Units waiting for a worker slot — depth past the pool. */
  queueDepth: z.number().int().nonnegative(),
  /** The worker-pool size the queue cap is derived from. */
  poolSize: z.number().int().positive(),
  /** The three-way latency split the report requires: fetch, inference, end to end. */
  featureFetch: percentilesSchema,
  inference: percentilesSchema,
  warmPath: percentilesSchema,
  /** Ingestion latency — the CRITICAL_PLUS path that must stay flat while the warm path collapses. */
  ingestion: percentilesSchema,
  /** Which tiers are being shed right now, in criticality order. */
  shedding: z.array(criticalitySchema),
  /** Cumulative counts of work shed and work run, per tier — the degradation made countable. */
  shed: z.record(criticalitySchema, z.number().int().nonnegative()),
  ran: z.record(criticalitySchema, z.number().int().nonnegative()),
});
export type SystemHealthDto = z.infer<typeof systemHealthSchema>;

export const systemHealthResponseSchema = z.object({ health: systemHealthSchema });
export type SystemHealthResponse = z.infer<typeof systemHealthResponseSchema>;
