import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { systemHealthResponseSchema, type SystemHealthResponse } from '@sentinel/contracts';
import { SessionGuard } from '../auth/session.guard.js';
import { LoadService } from './load.service.js';

const PROBE_ENABLED = process.env.ENABLE_LOAD_PROBE === '1';

// Representative warm-path costs. The feature fetch is modelled as an async wait because the online
// store read is the term that dominates the warm path (§6.5); inference is a little real CPU. These
// are the levers a load test drives the system past its knee with.
const FEATURE_FETCH_MS = Number(process.env.PROBE_FEATURE_MS ?? 8);
const INFERENCE_MS = Number(process.env.PROBE_INFERENCE_MS ?? 1);
const INGEST_MS = Number(process.env.PROBE_INGEST_MS ?? 2);

@Controller('system')
export class SystemController {
  constructor(private readonly load: LoadService) {}

  /** The live health snapshot the console renders. Guarded like the rest of the console API. */
  @Get('health')
  @UseGuards(SessionGuard)
  health(): SystemHealthResponse {
    return systemHealthResponseSchema.parse({ health: this.load.snapshot() });
  }

  /**
   * The same snapshot, unauthenticated, mounted only under ENABLE_LOAD_PROBE. The load generator
   * reads shed counts and server-side percentiles from here without a session — a benchmark surface,
   * not a product one, and gated exactly like the probes it accompanies.
   */
  @Get('health-open')
  healthOpen(): SystemHealthResponse {
    if (!PROBE_ENABLED) throw new NotFoundException();
    return systemHealthResponseSchema.parse({ health: this.load.snapshot() });
  }

  /**
   * The warm-path load probe: representative work through the bounded pool, with enrichment shed by
   * the load controller under pressure. Only mounted when ENABLE_LOAD_PROBE=1 — it is a benchmark
   * surface, not a product endpoint, and it is unauthenticated precisely so a load generator can
   * drive it without a session muddying the latency it is trying to measure.
   */
  @Get('probe/warm')
  async warmProbe(): Promise<{ scored: boolean; narrated: boolean }> {
    if (!PROBE_ENABLED) throw new NotFoundException();
    return this.load.runWarm(async () => {
      const fetchStart = performance.now();
      await sleep(FEATURE_FETCH_MS);
      this.load.recordFeatureFetch(performance.now() - fetchStart);

      let scored = false;
      if (!this.load.shouldShed('model_scoring')) {
        const inferStart = performance.now();
        burn(INFERENCE_MS);
        this.load.recordInference(performance.now() - inferStart);
        scored = true;
      }

      // Narration is the cheapest to lose; the template stands in when it is shed.
      const narrated = !this.load.shouldShed('narration');
      return { scored, narrated };
    });
  }

  /**
   * The ingestion probe: CRITICAL_PLUS, so it never goes through the pool and never sheds. Under the
   * same offered load that collapses the warm path, this latency must stay flat — that contrast is
   * the whole demonstration that the criticality taxonomy holds.
   */
  @Get('probe/ingest')
  ingestProbe(): { accepted: true } {
    if (!PROBE_ENABLED) throw new NotFoundException();
    const start = performance.now();
    burn(INGEST_MS);
    this.load.recordIngestion(performance.now() - start);
    return { accepted: true };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A short, real CPU burn — enough to be a measurable cost, small enough not to model-lock the loop.
function burn(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    /* spin */
  }
}
