import { Injectable } from '@nestjs/common';
import {
  LatencyWindow,
  Shedder,
  tierOf,
  type Component,
  type Criticality,
  type LoadSignals,
} from '@sentinel/load';
import type { SystemHealthDto } from '@sentinel/contracts';

const TIERS: Criticality[] = ['CRITICAL_PLUS', 'CRITICAL', 'SHEDDABLE_PLUS', 'SHEDDABLE'];

/**
 * The load controller: the one place that knows how loaded the system is, and therefore the one
 * place that decides what to shed.
 *
 * It owns a bounded worker pool for the warm path (a semaphore sized to the pool, with everything
 * past it counted as queue depth), the three latency windows the report splits on, and the shed and
 * run tallies per tier. Sheddable components ask it `shouldShed` before doing their work; the warm
 * path passes through `runWarm`, which enforces the pool and records the end-to-end time. Ingestion
 * does not go through the pool at all — that is the point of it being CRITICAL_PLUS, and it is what
 * keeps its latency flat while the warm path is collapsing under the same offered load.
 *
 * @Global so any module can consult it without wiring, the way the audit service is shared.
 */
@Injectable()
export class LoadService {
  private readonly shedder = new Shedder();
  private readonly warmPath = new LatencyWindow();
  private readonly featureFetch = new LatencyWindow();
  private readonly inference = new LatencyWindow();
  private readonly ingestion = new LatencyWindow();

  private readonly poolSize = Number(process.env.WARM_POOL_SIZE ?? 8);
  private readonly sloMs = Number(process.env.WARM_SLO_MS ?? 500);

  private inFlight = 0;
  private queueDepth = 0;
  private readonly waiters: (() => void)[] = [];

  private readonly shed: Record<Criticality, number> = zero();
  private readonly ran: Record<Criticality, number> = zero();

  /** The load signals a shed decision is made against, computed from the live state. */
  private signals(): LoadSignals {
    return {
      p99Ms: this.warmPath.p99(),
      sloMs: this.sloMs,
      inFlight: this.inFlight,
      queueDepth: this.queueDepth,
      poolSize: this.poolSize,
    };
  }

  /**
   * Whether a sheddable component should skip its work right now. Records the outcome either way, so
   * the health view can show how much was shed versus run per tier. Critical components may call this
   * too — it always answers false for them, which keeps the call sites uniform.
   */
  shouldShed(component: Component): boolean {
    const tier = tierOf(component);
    const verdict = this.shedder.decide(tier, this.signals());
    if (verdict.shed) this.shed[tier] += 1;
    else this.ran[tier] += 1;
    return verdict.shed;
  }

  /**
   * Run one warm-path unit through the bounded pool, recording the end-to-end time including any
   * wait. Beyond the pool, callers queue and the depth is what the shedder reads — shedding at the
   * producer means that depth rarely grows, but it is real when a burst outruns admission.
   */
  async runWarm<T>(work: () => Promise<T>): Promise<T> {
    const startedWaiting = now();
    await this.acquire();
    const ranAt = now();
    this.inFlight += 1;
    try {
      return await work();
    } finally {
      this.inFlight -= 1;
      this.release();
      this.warmPath.record(now() - startedWaiting);
      void ranAt;
    }
  }

  recordFeatureFetch(ms: number): void {
    this.featureFetch.record(ms);
  }

  recordInference(ms: number): void {
    this.inference.record(ms);
  }

  /** Ingestion records straight to its own window and never touches the pool. */
  recordIngestion(ms: number): void {
    this.ingestion.record(ms);
    this.ran.CRITICAL_PLUS += 1;
  }

  snapshot(): SystemHealthDto {
    return {
      sloMs: this.sloMs,
      inFlight: this.inFlight,
      queueDepth: this.queueDepth,
      poolSize: this.poolSize,
      featureFetch: this.featureFetch.snapshot(),
      inference: this.inference.snapshot(),
      warmPath: this.warmPath.snapshot(),
      ingestion: this.ingestion.snapshot(),
      shedding: this.shedder.shedding(this.signals()),
      shed: { ...this.shed },
      ran: { ...this.ran },
    };
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.poolSize) return Promise.resolve();
    this.queueDepth += 1;
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      this.queueDepth -= 1;
      next();
    }
  }
}

function zero(): Record<Criticality, number> {
  return TIERS.reduce(
    (acc, tier) => {
      acc[tier] = 0;
      return acc;
    },
    {} as Record<Criticality, number>,
  );
}

function now(): number {
  return Date.now();
}
