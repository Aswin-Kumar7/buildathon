# ADR-0003 — Optimise for the tail: symmetric trees and proactive shedding

**Date:** 2026-08-26
**Status:** accepted

## Context

A real-time detector is judged on its tail, not its mean. A p50 that looks healthy says nothing about
the p99 a user actually waits through, and two design choices in this system turn on that distinction:
which tree shape the model uses, and when the system starts shedding load.

## Decision

**1. Prefer the tail-friendly tree shape where p99 matters.**

LightGBM grows leaf-wise, producing asymmetric trees with variable path lengths and therefore a fatter
inference-latency tail: some rows traverse a short path, some a long one, and the long ones set p99.
Depth-limited symmetric trees (as in CatBoost, or LightGBM with a capped depth) trade a little accuracy
for a bounded, uniform path length and a tighter tail. Because Sentinel serves the model as a **linear**
`model.json`, single-row inference is already constant-time and off the critical path — measured here at
**p99 ≈ 1 ms** — so this ADR is recorded as the rule we would apply *if* a tree ensemble were ever served
directly: when p99 matters more than the last point of AUC, choose the symmetric shape.

**2. Shed proactively on the tail against the SLO, not at the edge of collapse.**

The load controller triggers shedding on **p99 vs the SLO**, not on average utilisation, because average
utilisation can look healthy long after the tail has gone bad. Shedding happens **at the producer** — work
is refused before it enters the worker pool — and the queue is capped at roughly **half the pool** (Google
SRE's ≤50% guidance: a queue 10× the pool at 100 ms processing adds ~1 s of pure wait). The order of
sacrifice is fixed by criticality: SHEDDABLE (narration) goes first and at the lightest strain, then
SHEDDABLE_PLUS (model, enrichment) once the tail is badly breached; the two CRITICAL tiers are never shed.

## Evidence it works

The measured load test (`docs/performance-report.md`) shows the second-run demonstration: past the knee,
warm-path p99 collapses by ~600× while **CRITICAL_PLUS ingestion latency stays flat** and tens of
thousands of SHEDDABLE_PLUS/SHEDDABLE units are shed. The tail is where the architecture is proven, and
it is proven by watching the protected tier hold while the sheddable ones give way.

## Consequences

Retry discipline follows from the same source: max 3 retries per request, per-client retries capped at
10% of total, and explicit do-not-retry signals under systemic overload — together holding worst-case
traffic amplification near 1.1× rather than 3×. Deadlines are absolute and propagated with each job, so
work whose budget has already elapsed in the queue is dropped rather than run late.
