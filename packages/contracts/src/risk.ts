import { z } from 'zod';

export const riskBandSchema = z.enum(['low', 'medium', 'high']);
export const riskDecisionSchema = z.enum(['allow', 'review', 'refuse']);

export const riskAssessmentSchema = z.object({
  score: z.number().min(0).max(1),
  band: riskBandSchema,
  decision: riskDecisionSchema,
  basis: z.literal('pre_checkout'),
  reasons: z.array(z.string()),
  signals: z.object({
    sessionAttempts: z.number().int().nonnegative(),
    deviceAttempts: z.number().int().nonnegative(),
    networkAttempts: z.number().int().nonnegative(),
    connectedSessions: z.number().int().nonnegative(),
    recentFailures: z.number().int().nonnegative(),
  }),
});
export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;
