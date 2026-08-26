import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CircuitBreaker,
  evidenceHash,
  fallbackChain,
  guarded,
  liveSelector,
  localSelector,
  replaySelector,
  templateSelector,
  runFallback,
  type NarrationFacts,
  type NarrationMode,
  type NarrationProvider,
  type Narrative,
  type ReplayStore,
} from '@sentinel/narrate';
import type { IncidentDetail, NarrativeDto } from '@sentinel/contracts';
import { IncidentsService } from '../incidents/incidents.service.js';
import { LoadService } from '../system/load.service.js';

/** Injection token for an optional remote narrator. Absent in the default build; supplied in tests. */
export const NARRATION_PROVIDER = Symbol('NARRATION_PROVIDER');

const MODES: readonly NarrationMode[] = ['live', 'local', 'replay', 'template'];

/**
 * Narration in the request path: turn an incident's verified record into a short account, from the
 * best tier that will answer, and never from anything a model made up.
 *
 * The service owns the machinery the pure package deliberately does not: the configured mode, the
 * response cache and the replay recording (one store does both — a live run's selection is what a
 * later replay reproduces), the circuit breaker in front of the provider, and a small concurrency
 * limit so a slow provider cannot pull in the whole worker pool. The catalog is validated at
 * startup, so a broken claim is a boot failure rather than a surprise mid-request.
 */
@Injectable()
export class NarrationService {
  private readonly logger = new Logger(NarrationService.name);
  private readonly mode: NarrationMode;

  // One map is both the response cache (by mode+hash) and the replay record (by hash). A live run
  // writes its selection under the hash; a later request in any mode can reproduce it.
  private readonly cache = new Map<string, Narrative>();
  private readonly replay: ReplayStore;

  private readonly breaker = new CircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 10_000,
    now: () => Date.now(),
  });

  // Bounded concurrency for provider calls, with the queue capped near half the limit, so a stalled
  // provider sheds load to the local tier instead of queuing every incident behind it.
  private inFlight = 0;
  private static readonly MAX_CONCURRENT = 4;
  private static readonly MAX_QUEUED = 2;
  private queued = 0;
  private readonly timeoutMs = 2_000;

  constructor(
    private readonly incidents: IncidentsService,
    private readonly load: LoadService,
    @Optional() @Inject(NARRATION_PROVIDER) private readonly provider?: NarrationProvider,
  ) {
    const configured = (process.env.NARRATION_MODE ?? 'local').toLowerCase();
    this.mode = (MODES as readonly string[]).includes(configured)
      ? (configured as NarrationMode)
      : 'local';

    const record = new Map<string, string[]>();
    this.replay = {
      get: (hash) => record.get(hash),
      put: (hash, ids) => void record.set(hash, ids),
    };

    this.logger.log(
      `narration mode=${this.mode} provider=${this.provider === undefined ? 'none' : 'configured'}`,
    );
  }

  /** The narrative for one incident, built from its verified record. Throws if the incident is unknown. */
  async narrate(incidentId: string): Promise<NarrativeDto> {
    const detail = await this.incidents.detail(incidentId);
    const facts = NarrationService.factsFrom(detail);
    const hash = evidenceHash(facts);
    const cacheKey = `${this.mode}:${hash}`;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return this.toDto(cached);

    const narrative = await runFallback(facts, this.chainFor(facts), (chosen) => {
      // A live selection is the one worth recording, so the network can be pulled later and the
      // same account reproduced from replay rather than re-selected into something different.
      if (chosen.source === 'live')
        this.replay.put(
          chosen.evidenceHash,
          chosen.lines.map((l) => l.claimId),
        );
    });

    this.cache.set(cacheKey, narrative);
    if (narrative.dropped > 0) {
      // The hallucination SLI: a narrator naming claims that do not exist, made countable.
      this.logger.warn(`narration dropped ${narrative.dropped} claim(s) for ${incidentId}`);
    }
    return this.toDto(narrative);
  }

  /** The tiers to try, in order, for the configured mode. Live is present only when reachable. */
  private chainFor(_facts: NarrationFacts) {
    // Narration is SHEDDABLE: under load the load controller sheds it and the deterministic template
    // stands in, at no cost to safety. This is the shedding the health view counts in real time.
    if (this.load.shouldShed('narration')) return [templateSelector];

    const live =
      this.provider !== undefined && this.canRunProvider()
        ? guarded(liveSelector(this.gatedProvider(this.provider)), this.breaker, this.timeoutMs)
        : undefined;

    return fallbackChain(this.mode, {
      ...(live !== undefined ? { live } : {}),
      replay: replaySelector(this.replay),
      local: localSelector,
      template: templateSelector,
    });
  }

  // A provider wrapper that enforces the concurrency limit and the queue cap. Over the cap it throws,
  // and the fallback ladder drops to local — load shedding rather than an unbounded backlog.
  private gatedProvider(provider: NarrationProvider): NarrationProvider {
    return {
      propose: async (facts, available) => {
        if (this.inFlight >= NarrationService.MAX_CONCURRENT) {
          if (this.queued >= NarrationService.MAX_QUEUED) throw new Error('narration queue full');
          this.queued += 1;
          try {
            await this.waitForSlot();
          } finally {
            this.queued -= 1;
          }
        }
        this.inFlight += 1;
        try {
          return await provider.propose(facts, available);
        } finally {
          this.inFlight -= 1;
        }
      },
    };
  }

  private canRunProvider(): boolean {
    return (
      this.inFlight < NarrationService.MAX_CONCURRENT || this.queued < NarrationService.MAX_QUEUED
    );
  }

  private async waitForSlot(): Promise<void> {
    // Coarse but bounded: yield until a slot frees or the timeout window lapses. The hard timeout on
    // the provider call itself is what actually bounds latency; this only spaces out admission.
    const deadline = Date.now() + this.timeoutMs;
    while (this.inFlight >= NarrationService.MAX_CONCURRENT) {
      if (Date.now() >= deadline) throw new Error('timed out waiting for a narration slot');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private toDto(narrative: Narrative): NarrativeDto {
    return {
      lines: narrative.lines.map((line) => ({
        claimId: line.claimId,
        text: line.text,
        source: line.source,
        evidence: line.evidence,
      })),
      source: narrative.source,
      mode: this.mode,
      dropped: narrative.dropped,
      evidenceHash: narrative.evidenceHash,
    };
  }

  /** Map an incident's verified record onto the narration facts. The one place detail becomes facts. */
  static factsFrom(detail: IncidentDetail): NarrationFacts {
    return {
      entityKind: detail.entityKind,
      severity: detail.severity,
      score: detail.score,
      timeToDetectMs: detail.timeToDetectMs,
      evidence: detail.evidence.map((e) => ({
        rule: e.rule,
        code: e.code,
        observed: e.observed,
        threshold: e.threshold,
        weight: e.weight,
      })),
      best: detail.arbitration?.best ?? null,
      runnerUp: detail.arbitration?.runnerUp ?? null,
      decision: detail.arbitration?.decision ?? null,
      changeFired:
        detail.change === null
          ? null
          : { ewma: detail.change.ewma.fired, cusum: detail.change.cusum.fired },
      model:
        detail.modelOpinion === null
          ? null
          : {
              risk: detail.modelOpinion.risk,
              predictedClass: detail.modelOpinion.predictedClass,
              abstained: detail.modelOpinion.abstained,
            },
    };
  }
}
