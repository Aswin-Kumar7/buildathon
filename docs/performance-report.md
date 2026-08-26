# Performance report

> **This is a SYNTHETIC benchmark.** Every number here is a property of one laptop and a synthetic
> probe workload, generated deterministically and reproducible from a clean clone. None of it is a
> claim about production traffic, and none of it uses Razorpay data. The value is not the absolute
> milliseconds — it is that capacity and graceful degradation were **measured**, not asserted.

Generated from `scripts/loadtest.mjs` against the running API, plus `make eval` for the training
figures and `scripts/scenario-run.mjs` for the detection matrix. Commit `9a73dc4`.

---

## 1. Benchmark contract

A latency number without its conditions is not reportable. Here are the conditions.

| Field | Value |
|---|---|
| CPU | AMD Ryzen 7 4800H (8 cores / 16 threads) |
| RAM | 16.6 GB |
| OS | Windows 11 (10.0.26200) |
| Runtime | Node v22.19.0, Python 3.12.10 |
| Database | embedded PGlite (`DATABASE_URL=''`), the clean-clone path |
| Worker pool | 4 (`WARM_POOL_SIZE=4`) |
| Warm SLO | 200 ms (`WARM_SLO_MS=200`) |
| Probe workload | warm = async 20 ms feature fetch + 1 ms inference CPU + shed-gated narration; ingest = 2 ms CPU (HMAC + insert analogue) |
| Load model | open (constant arrival rate), latency timed from each request's *intended* send instant |
| Duration | 60 s per phase, first 15 s discarded as warm-up |
| Skew | none — a single uniform probe; real feature-cardinality skew is **not** modelled (see §6) |
| `dropped_iterations` | **0** in both phases |

The workload is a **probe**, not the product path, chosen so a load generator can drive the system
to its knee without auth or seeded incidents. It exercises the real load controller (`@sentinel/load`),
the real bounded pool and the real shed decision — only the units of work are synthetic.

---

## 2. Latency budget — target vs measured

Targets are from the architecture plan §6.1. Measured is the **server-side** p99 (the load controller's
own windows) in the below-knee phase, where the system is not saturated.

| Stage | Target p95 | Measured p99 (below knee) | Notes |
|---|---|---|---|
| Ingestion (HMAC + insert) | < 100 ms | **2.0 ms** | CRITICAL_PLUS; never enters the pool |
| Feature fetch | < 5 ms | **30.3 ms** | synthetic 20 ms + Windows timer floor (~15 ms); the dominant term, as expected |
| Inference | < 1 ms | **1.0 ms** | linear model, in-process, constant-time |
| Warm path end to end | < 500 ms | **32 ms** (server) / 79 ms (client) | comfortably under |

**The interesting term is the feature fetch, not the model** — exactly the point the plan makes. The
online-store read dominates the warm path; the model was never the thing that had to be fast, and the
measurement shows it (inference p99 1 ms against a feature-fetch p99 of ~30 ms).

> **Client vs server divergence, stated honestly.** Client-observed warm p50 is 65 ms while the server
> records 32 ms. The gap is loopback round-trip plus Windows' ~15 ms timer resolution inflating both the
> `setTimeout`-modelled feature fetch and the driver's own scheduling. The absolute below-knee numbers
> are therefore a ceiling, not a floor — but the **knee** and the **degradation demonstration** below do
> not depend on them, because they are about the *shape* of the curve, not its offset.

---

## 3. Load test — below the knee (40 warm req/s)

Client-observed, warm-up excluded, open model.

| Path | p50 | p95 | p99 | p99.9 | max | n |
|---|---|---|---|---|---|---|
| Warm | 65.6 ms | 78.0 ms | 79.4 ms | 88.9 ms | 89.9 ms | 1,800 |
| Ingestion | 38.9 ms | 48.7 ms | 50.0 ms | 53.3 ms | 55.3 ms | 1,800 |

Nothing shed (`SHEDDABLE_PLUS` and `SHEDDABLE` both ran 2,400 / shed 0), queue depth 0. The system is
inside its capacity and the tail is flat.

## 4. Load test — past the knee (260 warm req/s)

Offered load (260 req/s) exceeds warm-path capacity (~200 req/s at pool 4 × ~20 ms service), so the
queue grows without bound over the 60 s and the warm tail collapses.

| Path | p50 | p95 | p99 | p99.9 | max | n |
|---|---|---|---|---|---|---|
| Warm | 27,831 ms | 48,491 ms | 50,342 ms | 50,765 ms | 50,803 ms | 11,700 |
| **Ingestion** | 42.7 ms | 55.2 ms | **56.7 ms** | 59.2 ms | 65.5 ms | 1,800 |

`dropped_iterations = 0` — the load was delivered in full; the latency is real, not an artefact of the
generator giving up.

## 5. The degradation demonstration

This is the chart the architecture exists to produce. Same system, same offered ingestion load, two
warm-path phases:

| Signal | Below knee (40/s) | Past knee (260/s) | |
|---|---|---|---|
| Warm-path p99 (server) | 32 ms | **50,632 ms** | collapses ~1,580× |
| **Ingestion p99 (server)** | 2.01 ms | **2.01 ms** | **flat — never shed** |
| `SHEDDABLE_PLUS` shed | 0 | **15,597** | model/enrichment shed |
| `SHEDDABLE` shed | 0 | **15,597** | narration → template |
| Tiers shedding | none | `SHEDDABLE_PLUS`, `SHEDDABLE` | |

**Ingestion latency does not move while the warm path collapses**, because ingestion is `CRITICAL_PLUS`
and never enters the worker pool. Under the same pressure the load controller sheds enrichment and
narration — tens of thousands of units — so a decision still gets made on rules, marked `degraded`,
rather than the whole system queuing behind saturated enrichment. The criticality taxonomy holds under
measurement, not just on paper.

---

## 6. Honest limitations

- **Synthetic, single-machine, loopback.** Absolute numbers are contaminated by everything else on the
  laptop and by loopback; the clean benchmark VM (§6.8) is where reproducible absolutes belong.
- **No entity skew in the probe.** The real warm path's cost varies with feature cardinality and
  entity-key skew; the probe is uniform, so it measures the *mechanism* (pool, shedder, tiers), not the
  skew-dependent cost distribution. This is the single biggest gap between the probe and production.
- **Windows timer floor** (~15 ms) inflates the below-knee absolutes, as noted in §2.
- **Parquet pruning and the distributed comparison are documented, not run here** — DuckDB and a second
  node are not in this environment. See [ADR-0002](adr/2026-08-26-0002-single-machine-compute.md).

---

## 7. Training at scale

Peak resident memory during a full `make eval`, sampled at 50 Hz across the process tree:

| Model | Peak RSS | |
|---|---|---|
| Model A — calibrated gradient-boosted fraud model | **255 MB** | |
| Model B — incident classifier | **164 MB** | |

Both train in seconds and in a fraction of the 0.90 GB LightGBM's own published 10.5 M-row run used.
There is no memory pressure to distribute away — the single-machine decision is measured, not assumed.
See [ADR-0002](adr/2026-08-26-0002-single-machine-compute.md) and
[ADR-0003](adr/2026-08-26-0003-latency-tail-and-shedding.md).

---

## 8. Detection correctness across scenarios

Capacity is worthless if the detector is wrong, so the performance story sits beside a correctness one.
`scripts/scenario-run.mjs` runs all eight synthetic scenario families through the full detection
pipeline; the matrix is in [`performance/scenario-matrix.md`](performance/scenario-matrix.md). Headline:
**8/8 families judged correctly** — every attack caught, every benign or operational family left alone —
with one important architectural finding (a distributed attack that arbitration judges correctly but the
rule tier does not open an incident for) documented there in full.

---

## 9. Reproduce it

```bash
# 1. start the API with the load probe enabled (embedded Postgres, no credentials)
cd apps/api
DATABASE_URL='' ENABLE_LOAD_PROBE=1 WARM_POOL_SIZE=4 WARM_SLO_MS=200 PROBE_FEATURE_MS=20 \
  NODE_ENV=test PSEUDONYM_KEY_V1=test-only-pseudonym-key-0000000000000000000000000000 \
  PSEUDONYM_KEY_VERSION=1 RAZORPAY_WEBHOOK_SECRET=whsec_test_only_do_not_use \
  PAYLOAD_KEY_V1=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff \
  PAYLOAD_KEY_VERSION=1 INBOX_DRAIN_INTERVAL_MS=0 \
  node --import @swc-node/register/esm-register src/main.ts

# 2. drive it (60 s per phase, 15 s warm-up discarded)
node scripts/loadtest.mjs

# 3. the scenario matrix (no server needed)
node scripts/scenario-run.mjs
```
