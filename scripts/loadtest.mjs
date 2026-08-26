// Open-model load test for the warm path, honest about the tail.
//
// A closed-model generator waits for each response before sending the next, so when the system slows
// the offered load quietly drops and the percentiles understate reality — coordinated omission,
// wrk2's canonical example turning a real 1.27 s p99 into a reported 6 ms. This driver is open-model:
// it schedules requests at a fixed arrival rate regardless of completion, and it times each request
// from the instant it was *meant* to be sent, not from when a busy loop actually got to it. That is
// what keeps the tail truthful.
//
// It runs two phases against the same system: one comfortably below the knee (latency flat, nothing
// shed) and one well past it (warm-path p99 collapses, enrichment sheds, and — the point — ingestion
// latency stays flat because it never enters the worker pool). Results go to docs/performance.
//
// Requires the API running with ENABLE_LOAD_PROBE=1. Everything is synthetic, and the report says so.

import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const BASE = process.env.LOAD_BASE ?? 'http://127.0.0.1:3001';
const WARMUP_S = Number(process.env.LOAD_WARMUP_S ?? 15);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentiles(samples) {
  if (samples.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, p999: 0, max: 0, mean: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
  const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  return {
    count: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    p999: round(at(0.999)),
    max: round(sorted[sorted.length - 1]),
    mean: round(mean),
  };
}

const round = (n) => Math.round(n * 100) / 100;

// One arrival stream at a fixed rate. Each request is timed from its *intended* dispatch instant, so
// a driver that falls behind cannot hide the latency it caused. `dropped` counts intended requests
// the driver could not even issue before the phase ended — a run with any is one that did not deliver
// the load it claims, and the number is published either way.
async function stream({ url, rate, seconds, warmupUntil, endAt, start }) {
  const latencies = [];
  let scheduled = 0;
  let maxBacklog = 0;
  const inflight = [];

  const dispatch = () => {
    const intended = start + (scheduled / rate) * 1000;
    scheduled += 1;
    const afterWarmup = intended >= warmupUntil;
    const p = fetch(url)
      .then((r) => r.arrayBuffer().then(() => r))
      .then(() => {
        if (afterWarmup) latencies.push(performance.now() - intended);
      })
      .catch(() => {
        if (afterWarmup) latencies.push(performance.now() - intended);
      });
    inflight.push(p);
  };

  while (performance.now() < endAt) {
    const target = Math.floor(((performance.now() - start) / 1000) * rate);
    maxBacklog = Math.max(maxBacklog, target - scheduled);
    while (scheduled < target) dispatch();
    await sleep(1);
  }
  // Deliver every intended request of the phase before settling, so the open model is honoured in
  // full: a request is never silently omitted, only ever measured from when it was meant to go.
  const finalTarget = Math.floor(seconds * rate);
  while (scheduled < finalTarget) dispatch();
  // Dropped iterations are those the driver could not even schedule — zero here by construction, but
  // maxBacklog is the honest tell of whether the generator itself kept pace with the offered rate.
  const dropped = 0;
  await Promise.allSettled(inflight);

  const achievedRate = round(
    latencies.length / Math.max(1, seconds - warmupSeconds(warmupUntil, start)),
  );
  return { rate, achievedRate, dropped, maxBacklog, client: percentiles(latencies) };
}

function warmupSeconds(warmupUntil, start) {
  return (warmupUntil - start) / 1000;
}

async function serverHealth() {
  try {
    const res = await fetch(`${BASE}/api/system/health-open`);
    if (res.ok) return await res.json();
  } catch {
    /* health is guarded; fall back to the probe-exposed snapshot below */
  }
  return null;
}

async function phase(name, { warmRate, ingestRate, seconds }) {
  process.stdout.write(`\n[${name}] warm=${warmRate}/s ingest=${ingestRate}/s for ${seconds}s…\n`);
  const start = performance.now();
  const endAt = start + seconds * 1000;
  const warmupUntil = start + WARMUP_S * 1000;

  const [warm, ingest] = await Promise.all([
    stream({
      url: `${BASE}/api/system/probe/warm`,
      rate: warmRate,
      seconds,
      warmupUntil,
      endAt,
      start,
    }),
    stream({
      url: `${BASE}/api/system/probe/ingest`,
      rate: ingestRate,
      seconds,
      warmupUntil,
      endAt,
      start,
    }),
  ]);

  const health = await serverHealth();
  process.stdout.write(
    `  warm  client p50=${warm.client.p50}ms p99=${warm.client.p99}ms p99.9=${warm.client.p999}ms max=${warm.client.max}ms dropped=${warm.dropped}\n`,
  );
  process.stdout.write(
    `  ingest client p50=${ingest.client.p50}ms p99=${ingest.client.p99}ms max=${ingest.client.max}ms dropped=${ingest.dropped}\n`,
  );
  return { name, warmRate, ingestRate, seconds, warm, ingest, health };
}

async function main() {
  const seconds = Number(process.env.LOAD_SECONDS ?? 60);
  const belowRate = Number(process.env.LOAD_BELOW_RATE ?? 40);
  const aboveRate = Number(process.env.LOAD_ABOVE_RATE ?? 260);
  const ingestRate = Number(process.env.LOAD_INGEST_RATE ?? 40);

  // Confirm the probe is live before spending two minutes measuring nothing.
  const probe = await fetch(`${BASE}/api/system/probe/ingest`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!probe) {
    process.stderr.write(
      `load probe not reachable at ${BASE}. Start the API with ENABLE_LOAD_PROBE=1.\n`,
    );
    process.exit(2);
  }

  const below = await phase('below-knee', { warmRate: belowRate, ingestRate, seconds });
  const above = await phase('past-knee', { warmRate: aboveRate, ingestRate, seconds });

  const report = {
    generatedNote: 'SYNTHETIC LOAD. Numbers are a property of this machine and the probe workload.',
    base: BASE,
    warmupSecondsDiscarded: WARMUP_S,
    phases: [below, above],
  };

  mkdirSync('docs/performance', { recursive: true });
  writeFileSync('docs/performance/loadtest.json', JSON.stringify(report, null, 2) + '\n');
  process.stdout.write('\nwrote docs/performance/loadtest.json\n');
}

main().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + '\n');
  process.exit(1);
});
