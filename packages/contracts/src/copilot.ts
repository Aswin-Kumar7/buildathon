import { z } from 'zod';

/**
 * The incident copilot — a grounded question-and-answer over ONE incident's verified record.
 *
 * Unlike the risk manager (which selects a structured action), the copilot answers a merchant's
 * free-text question in prose. It is an LLM-only surface: there is no deterministic fallback for an
 * arbitrary question, so when the live model cannot be reached the answer is unavailable rather than
 * invented. Its context is the same PII-free incident facts the rest of the console reasons on.
 */
export const copilotAskRequestSchema = z.object({
  question: z.string().min(1).max(500),
});
export type CopilotAskRequest = z.infer<typeof copilotAskRequestSchema>;

export const copilotAnswerResponseSchema = z.object({
  incidentId: z.string(),
  /** False when the live model could not be reached — the copilot never fabricates an answer. */
  available: z.boolean(),
  /** The model's grounded answer. Empty when `available` is false. */
  answer: z.string(),
});
export type CopilotAnswerResponse = z.infer<typeof copilotAnswerResponseSchema>;
