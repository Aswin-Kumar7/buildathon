/**
 * Google SRE's criticality taxonomy, applied to Sentinel's components.
 *
 * The point of naming tiers is that shedding becomes a decision made once, at the top, rather than
 * an accident that happens wherever a queue fills first. Under load the system must fail in a chosen
 * order: the narrative goes before the model, the model goes before a decision, and a decision goes
 * before an event is ever dropped on the floor — because a dropped event is a payment we can no
 * longer reason about, and everything else is a degradation we can recover from.
 *
 * The tiers, highest to lowest:
 *
 *   CRITICAL_PLUS  — webhook ingestion and durable persistence. Never shed. If we cannot persist we
 *                    return non-2xx so Razorpay retries; we never accept and then lose.
 *   CRITICAL       — rules, arbitration, policy, audit. Never dropped; degrades to rules-only and
 *                    marks the decision degraded, but always produces one.
 *   SHEDDABLE_PLUS — model scoring, enrichment features, dashboard queries. Shed under pressure, and
 *                    when shed the work is *omitted*, never replaced with a default value — a missing
 *                    feature defaulted to zero hides an attack, defaulted high blocks a real buyer.
 *   SHEDDABLE      — narration, report generation, non-critical polling. Dropped freely; the
 *                    deterministic template narrative stands in with no loss of safety.
 */

export type Criticality = 'CRITICAL_PLUS' | 'CRITICAL' | 'SHEDDABLE_PLUS' | 'SHEDDABLE';

/** Ordered most critical first, so a shedder can walk from the bottom up. */
export const CRITICALITY_ORDER: readonly Criticality[] = [
  'CRITICAL_PLUS',
  'CRITICAL',
  'SHEDDABLE_PLUS',
  'SHEDDABLE',
];

/** Every named unit of work, mapped to the tier that governs it under load. */
export const COMPONENT_TIER = {
  webhook_ingestion: 'CRITICAL_PLUS',
  durable_persistence: 'CRITICAL_PLUS',
  rules: 'CRITICAL',
  arbitration: 'CRITICAL',
  policy_decision: 'CRITICAL',
  audit_write: 'CRITICAL',
  model_scoring: 'SHEDDABLE_PLUS',
  enrichment_features: 'SHEDDABLE_PLUS',
  dashboard_query: 'SHEDDABLE_PLUS',
  narration: 'SHEDDABLE',
  report_generation: 'SHEDDABLE',
  ui_polling: 'SHEDDABLE',
} as const satisfies Record<string, Criticality>;

export type Component = keyof typeof COMPONENT_TIER;

export function tierOf(component: Component): Criticality {
  return COMPONENT_TIER[component];
}

/** The two critical tiers are never shed — stated as a predicate so the rule is in one place. */
export function isSheddable(tier: Criticality): boolean {
  return tier === 'SHEDDABLE_PLUS' || tier === 'SHEDDABLE';
}
