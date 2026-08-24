# Sentinel

Merchant-side detection and safe response for suspicious failed-payment clusters — and,
more importantly, the ability to tell those apart from gateway outages and legitimate
retry storms.

> Sentinel detects and safely responds to merchant-side suspicious failed-payment clusters,
> while explicitly separating likely attack behaviour from outage, retry-storm and flash-sale
> lookalikes.

Built for the Razorpay AI Buildathon, Track 02 — AI Risk Manager.

**It is not** equivalent to Razorpay's production fraud platform, is not trained on Razorpay
data, and cannot stop all card-testing attempts. Its claim is evidence quality, safety controls
and evaluation rigour.

## Status

Slice 0 — foundation. See [`docs/delivery-plan.md`](docs/delivery-plan.md) for what lands when.

## Quick start

```bash
pnpm install
cp .env.example .env
make up          # postgres, redis, minio, mailpit
pnpm dev         # api on :3001, web on :5173
```

Run every gate the way CI does:

```bash
pnpm check
```

## Documentation

| Document | What it covers |
|---|---|
| [`docs/sentinel-architecture-plan-v2.md`](docs/sentinel-architecture-plan-v2.md) | Architecture, evidence model, ML design, scale engineering |
| [`docs/delivery-plan.md`](docs/delivery-plan.md) | The 17 slices, their tests and their tags |
| [`docs/adr/`](docs/adr/) | Architecture decision records, including what was rejected |

## Evidence boundary

Three layers, never blended. This table is repeated in `METRICS.md` and is the first thing
a reviewer should read.

| Layer | Source | What it proves |
|---|---|---|
| L1 — integration | Real Razorpay test-mode webhooks | The ingestion contract works against the real sandbox |
| L2 — scenario compliance | Seeded synthetic corpus, pre-registered | The detector complies with disclosed scenario specifications |
| L3 — benchmark | Public labelled fraud data | Precision and recall on labels we did not author |

## Licence

MIT. No dataset files are committed to this repository.
