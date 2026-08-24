import { z } from 'zod';

/**
 * The health contract is shared by the API and the web app so a drift between
 * them is a type error rather than a runtime surprise. Every cross-boundary
 * payload in this project is defined here first.
 */
export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  commit: z.string().min(1),
  startedAt: z.string().datetime(),
});

export type Health = z.infer<typeof healthSchema>;
