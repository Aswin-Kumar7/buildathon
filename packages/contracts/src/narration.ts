import { z } from 'zod';

/**
 * The narrative contract. Parsed on the way out like every other response, so a line that somehow
 * carried something other than a known source or a bound string never reaches the console.
 */

/** Which tier chose the claims — the badge a reader sees on every line. */
export const narrationSourceSchema = z.enum(['live', 'local', 'replay', 'template']);
export type NarrationSourceDto = z.infer<typeof narrationSourceSchema>;

export const narrativeLineSchema = z.object({
  /** The atomic claim this line is. Stable, and the only thing a model ever chose. */
  claimId: z.string(),
  /** The rendered sentence. Bound from evidence in code — never authored by a model. */
  text: z.string(),
  source: narrationSourceSchema,
  /** The evidence codes / fact keys this line's values were bound from, for traceability. */
  evidence: z.array(z.string()),
});
export type NarrativeLineDto = z.infer<typeof narrativeLineSchema>;

export const narrativeSchema = z.object({
  lines: z.array(narrativeLineSchema),
  /** The tier that produced the narrative. Equal to each line's source; surfaced once for the header. */
  source: narrationSourceSchema,
  /** The configured mode this was requested at, which may be higher than the source it fell to. */
  mode: narrationSourceSchema,
  /** How many chosen claim ids the guard dropped — the hallucination signal for this narrative. */
  dropped: z.number().int().nonnegative(),
  /** The fingerprint of the evidence this narrates. Identical evidence, identical narrative. */
  evidenceHash: z.string(),
});
export type NarrativeDto = z.infer<typeof narrativeSchema>;

export const narrativeResponseSchema = z.object({ narrative: narrativeSchema });
export type NarrativeResponse = z.infer<typeof narrativeResponseSchema>;
