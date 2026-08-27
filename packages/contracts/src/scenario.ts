import { z } from 'zod';
import { evaluateResponseSchema } from './incident.js';

export const scenarioSummarySchema = z.object({
  family: z.string(),
  title: z.string(),
  narrative: z.string(),
  classification: z.enum(['benign', 'operational', 'attack']),
  correlation: z.string(),
  recommendedAction: z.string(),
  /** Why this scenario is hard, or why getting it wrong would be expensive. */
  difficulty: z.string(),
});
export type ScenarioSummary = z.infer<typeof scenarioSummarySchema>;

export const scenarioListResponseSchema = z.object({
  scenarios: z.array(scenarioSummarySchema),
  /**
   * Kept apart on purpose. Replayed events go through the same ingestion and resolution as
   * live traffic, but must never be countable as evidence that the system works against
   * Razorpay — so the console shows which is which rather than one combined total.
   */
  counts: z.object({
    razorpay: z.number().int().nonnegative(),
    replay: z.number().int().nonnegative(),
  }),
});
export type ScenarioListResponse = z.infer<typeof scenarioListResponseSchema>;

export const replayResultSchema = z.object({
  family: z.string(),
  checkoutsWritten: z.number().int().nonnegative(),
  eventsWritten: z.number().int().nonnegative(),
  duplicatesSkipped: z.number().int().nonnegative(),
  /** Detection is part of replay completion, not a separate manual step. */
  detection: evaluateResponseSchema,
});
export type ReplayResult = z.infer<typeof replayResultSchema>;
