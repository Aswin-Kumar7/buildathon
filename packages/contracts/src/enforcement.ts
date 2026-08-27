import { z } from 'zod';

/**
 * The runtime enforcement state — the operator's emergency stop.
 *
 * Distinct from the policy kill switch: that is a reviewed policy value, changed through the
 * draft→approve→publish workflow; this is an operational action one operator takes in an emergency,
 * instantly. Paused means Sentinel will not block anyone and every live block has already been
 * released. It is recorded and reported as exactly that — an operator's action, never disguised as a
 * change to the reviewed policy.
 */
export const enforcementStateSchema = z.object({
  paused: z.boolean(),
  /** When the current state began (ISO), or null if it has never changed from the boot default. */
  since: z.string().datetime().nullable(),
  /** Who put it in this state, or null when unknown. */
  by: z.string().nullable(),
  /** The reason they gave, or null. */
  reason: z.string().nullable(),
});
export type EnforcementState = z.infer<typeof enforcementStateSchema>;

/** Pausing or resuming — a short reason is optional but encouraged, and rides into the audit log. */
export const enforcementActionRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type EnforcementActionRequest = z.infer<typeof enforcementActionRequestSchema>;

/** Engaging the pause returns the new state and how many live blocks it released. */
export const enforcementPauseResponseSchema = z.object({
  state: enforcementStateSchema,
  released: z.number().int().nonnegative(),
});
export type EnforcementPauseResponse = z.infer<typeof enforcementPauseResponseSchema>;
