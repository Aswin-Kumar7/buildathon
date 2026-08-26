/**
 * The shed decision: given where the system is right now, may this unit of work run?
 *
 * Two principles from Google SRE shape it. First, **shed proactively, on the tail against the SLO,
 * not at the edge of collapse** — p99 breaching its target is the trigger, because average
 * utilisation can look healthy long after the tail has gone bad. Second, **shed at the producer**:
 * refuse the work before it enters a queue, rather than letting the queue grow and adding latency to
 * everything behind it. The queue is therefore bounded at roughly half the worker pool, per SRE's
 * ≤50% guidance, and depth past that cap is itself a shed trigger.
 *
 * The order of sacrifice is fixed by criticality. The two critical tiers are never shed — they
 * degrade in place instead. Of the sheddable tiers, SHEDDABLE goes first and at the lightest
 * pressure (a template narrative costs nothing), and SHEDDABLE_PLUS only once the tail is genuinely
 * breached, because shedding enrichment means a decision runs on less evidence.
 */

import { CRITICALITY_ORDER, isSheddable, type Criticality } from './criticality.js';

export interface LoadSignals {
  /** Current p99 of the warm path, in milliseconds. */
  p99Ms: number;
  /** The SLO the p99 is judged against. */
  sloMs: number;
  /** Jobs in flight right now. */
  inFlight: number;
  /** Jobs waiting to start. */
  queueDepth: number;
  /** The worker-pool size; the queue cap is derived from it. */
  poolSize: number;
}

export interface ShedVerdict {
  shed: boolean;
  reason: 'ok' | 'p99-breach' | 'queue-cap' | 'never-shed';
}

/** The queue may grow to about half the pool before depth alone starts shedding (SRE ≤50%). */
export function queueCap(poolSize: number): number {
  return Math.max(1, Math.floor(poolSize / 2));
}

export class Shedder {
  constructor(
    // How far past the SLO the p99 must be before SHEDDABLE_PLUS (the heavier tier) is shed. Below
    // this, only the lightest tier sheds; a small breach should not yet cost a decision its evidence.
    private readonly plusBreachFactor = 1.5,
  ) {}

  /**
   * Whether work of a given tier should be shed under the current signals. Critical tiers are never
   * shed; the answer for them is always "run, degrade in place if you must".
   */
  decide(tier: Criticality, signals: LoadSignals): ShedVerdict {
    if (!isSheddable(tier)) return { shed: false, reason: 'never-shed' };

    const overCap = signals.queueDepth > queueCap(signals.poolSize);
    const p99Breached = signals.p99Ms > signals.sloMs;
    const p99BadlyBreached = signals.p99Ms > signals.sloMs * this.plusBreachFactor;

    if (tier === 'SHEDDABLE') {
      // The cheapest tier sheds at the first sign of strain — a breached tail or a filling queue.
      if (p99Breached || overCap) {
        return { shed: true, reason: overCap ? 'queue-cap' : 'p99-breach' };
      }
      return { shed: false, reason: 'ok' };
    }

    // SHEDDABLE_PLUS: shed only once the tail is badly breached or the queue is over its cap, since
    // shedding here means a decision runs on less evidence.
    if (p99BadlyBreached) return { shed: true, reason: 'p99-breach' };
    if (overCap) return { shed: true, reason: 'queue-cap' };
    return { shed: false, reason: 'ok' };
  }

  /** The tiers currently being shed, in criticality order — the summary the health view renders. */
  shedding(signals: LoadSignals): Criticality[] {
    return CRITICALITY_ORDER.filter((tier) => this.decide(tier, signals).shed);
  }
}
