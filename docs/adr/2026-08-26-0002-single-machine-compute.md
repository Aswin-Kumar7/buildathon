# ADR-0002 — Single-machine compute; distributed rejected with evidence

**Date:** 2026-08-26
**Status:** accepted

## Context

A payments-scale detector invites the assumption that it must be distributed — Spark for the data,
a cluster for training, a shard per entity for serving. The Buildathon rewards engineering judgment,
and "we used a cluster" is only judgment if the alternative was actually worse. It usually is not, at
our data volume, and asserting scalability we never measured would be exactly the kind of unfalsifiable
claim the rest of this project is built to avoid.

Our corpus is **10–100 million synthetic events** — the same order of magnitude as workloads that are
documented to run comfortably on one machine.

## Decision

**Everything runs on a single machine, and the decision is defended rather than defaulted into.**

- **Training.** LightGBM's own published run trained 10.5 M rows × 28 features in 130 s using 0.90 GB
  peak on one server. Measured here, both models train in well under that: Model A (the calibrated
  gradient-boosted fraud model) peaks at **255 MB RSS**, Model B (the incident classifier) at **164 MB**,
  each in seconds. There is no memory pressure to distribute away. Levers documented if the corpus grew
  an order of magnitude: `max_bin=63`, `force_col_wise=true`, `two_round=true`; and XGBoost external
  memory with `hist` on NVMe as the single-node escape hatch before any cluster.

- **Serving.** The model is exported to a linear `model.json` and scored in-process in the Node worker —
  no network hop, no Python process, no IPC. Single-row scoring is exactly where in-process wins most.

- **Data at rest.** Partitioned Parquet with partition- and column-pruning, and deliberate
  memory-capped spilling, is the single-node story. It is **documented, not attempted** here: DuckDB is
  not installed in the build environment, and rather than fake an `EXPLAIN ANALYZE` we state the method
  and its expected 10–100× pruning reduction, to be run on the clean benchmark VM (§6.8) where the
  numbers are reproducible.

## The "distributed was slower" data point

This is documented, not benchmarked here, because an honest distributed comparison needs a real second
node (reserved for the cloud benchmark VM, §6.8) — a simulated one would prove nothing. The evidence the
decision rests on:

- **Dask** documents 200 µs–1 ms of scheduler overhead *per task*; independent benchmarks put it ~27.9×
  slower than DuckDB at 100 GB. At our volume the coordination cost dominates the work.
- **The COST paper** ("Scalability! But at what COST?", McSherry et al.) found systems on 128 cores
  underperforming a competent single thread. The relevant question is not "does it scale" but "does it
  beat one machine doing the same work" — and often it does not until far past our data size.

## Consequences

The clean-clone, no-credential path stays the primary demonstration: a reviewer runs the whole thing on
a laptop. Cloud (§6.8) is reserved for a contamination-free benchmark VM, the headroom scale run, and a
live demo endpoint — not for the development loop, and never as a credential a reviewer must hold.

The risk we accept: if event volume genuinely exceeded a single worker deployment, the inbox would move
to Kafka/Kinesis with partitioned consumers keyed so one entity's windowed state stays node-local
(avoiding a shuffle). That is the documented next step, gated on a measured need we do not yet have.
