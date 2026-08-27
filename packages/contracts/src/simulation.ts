import { z } from 'zod';

/** The scenario a run is generating, from the committed catalogue (never invented). */
export const simulationScenarioSchema = z.object({
  family: z.string(),
  title: z.string(),
  description: z.string(),
  classification: z.enum(['benign', 'operational', 'attack']),
});
export type SimulationScenario = z.infer<typeof simulationScenarioSchema>;

/** One real event the run produced: a processed payment attempt, or an incident the detector opened. */
export const simulationActivitySchema = z.object({
  at: z.number().int(),
  kind: z.enum(['payment', 'incident']),
  paymentId: z.string().nullable(),
  status: z.string().nullable(),
  amountPaise: z.number().int().nullable(),
  method: z.string().nullable(),
  title: z.string().nullable(),
  severity: z.enum(['low', 'medium', 'high']).nullable(),
  incidentId: z.string().nullable(),
});
export type SimulationActivity = z.infer<typeof simulationActivitySchema>;

/** An incident the detector actually created during the run — what Sentinel detected, not what was asked for. */
export const simulationDetectedSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  score: z.number(),
  status: z.string(),
  entityKind: z.string(),
});
export type SimulationDetected = z.infer<typeof simulationDetectedSchema>;

/**
 * An incident the detector opened on a burst and then stood down — re-evaluated as legitimate
 * activity (a biller's dunning, a gateway outage) and resolved without acting. Kept apart from
 * {@link simulationDetectedSchema}: this is the detector's judgment on show, not a detection, and
 * counting it as one would report a false positive it already retracted.
 */
export const simulationStoodDownSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  entityKind: z.string(),
  /** The benign explanation it was re-classified as — e.g. 'retry storm', 'outage', 'healthy traffic'. */
  resolvedAs: z.string(),
});
export type SimulationStoodDown = z.infer<typeof simulationStoodDownSchema>;

/**
 * The phase, derived from real run signals — never a timer. `generating` while transactions are still
 * being streamed; `analyzing` once the detector is draining/evaluating; `incident` once one is opened.
 */
export const simulationPhaseSchema = z.enum(['idle', 'generating', 'analyzing', 'incident']);
export type SimulationPhase = z.infer<typeof simulationPhaseSchema>;

/** The live state of the streaming transaction simulator, computed from real backend state each poll. */
export const simulationStatusSchema = z.object({
  running: z.boolean(),
  phase: simulationPhaseSchema,
  /** Payment attempts streamed into the pipeline this run. */
  emitted: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** Distinct payments drained + correlated into entities this run. */
  attemptsCorrelated: z.number().int().nonnegative(),
  /** Incidents the detector opened this run. */
  incidentsDetected: z.number().int().nonnegative(),
  /** Detection passes the process loop has run this run. */
  evaluations: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  scenario: simulationScenarioSchema.nullable(),
  recentActivity: z.array(simulationActivitySchema),
  detected: z.array(simulationDetectedSchema),
  /** Incidents opened on a burst and then re-classified as benign and resolved — judgment, not detections. */
  stoodDown: z.array(simulationStoodDownSchema),
});
export type SimulationStatus = z.infer<typeof simulationStatusSchema>;

/** A durable record of one past run and what Sentinel detected — survives the per-run data reset. */
export const simulationRunSchema = z.object({
  id: z.string(),
  family: z.string(),
  scenarioTitle: z.string(),
  classification: z.string(),
  status: z.string(),
  paymentsGenerated: z.number().int().nonnegative(),
  attemptsCorrelated: z.number().int().nonnegative(),
  incidentsDetected: z.number().int().nonnegative(),
  detected: z.array(
    z.object({
      title: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
      score: z.number(),
      entityKind: z.string(),
    }),
  ),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});
export type SimulationRun = z.infer<typeof simulationRunSchema>;

export const simulationRunsResponseSchema = z.object({ runs: z.array(simulationRunSchema) });
export type SimulationRunsResponse = z.infer<typeof simulationRunsResponseSchema>;

export const simulationStartRequestSchema = z.object({ family: z.string().optional() });
export type SimulationStartRequest = z.infer<typeof simulationStartRequestSchema>;

export const simulationStartResponseSchema = z.object({
  running: z.boolean(),
  total: z.number().int().nonnegative(),
});
export type SimulationStartResponse = z.infer<typeof simulationStartResponseSchema>;
