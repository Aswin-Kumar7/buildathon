# Current status

Single source of truth for where Sentinel actually stands. Updated with every change.

**Last updated:** 2026-08-24
**Current slice:** 1 — Landing page (complete, awaiting tag)
**Latest tag:** `v0.0.1` → `v0.1.0` pending

## Slice progress

| # | Slice | Tag | Status |
|---|---|---|---|
| 0 | Foundation | `v0.0.1` | **done** |
| 1 | Landing page | `v0.1.0` | **done** |
| 2 | Auth and app shell | `v0.2.0` | **next** |
| 3 | Storefront and Razorpay orders | `v0.3.0` | not started |
| 4 | Webhook ingestion | `v0.4.0` | not started |
| 5 | Canonical state | `v0.5.0` | not started |
| 6 | Scenario corpus and replay | `v0.6.0` | not started |
| 7 | Features, tiles and sketches | `v0.7.0` | not started |
| 8 | Rules to incidents | `v0.8.0` | not started |
| 9 | Arbitration and suppression | `v0.9.0` | not started |
| 10 | Policy, approval and containment | `v0.10.0` | not started |
| 11 | Audit chain | `v0.11.0` | not started |
| 12 | Model A — real labelled benchmark | `v0.12.0` | not started |
| 13 | Model B and ONNX serving | `v0.13.0` | not started |
| 14 | Narration | `v0.14.0` | not started |
| 15 | Performance and degradation | `v0.15.0` | not started |
| 16 | Submission | `v1.0.0` | not started |

## What exists right now

**Workspace** — pnpm + Turborepo monorepo. `apps/api` (NestJS), `apps/web` (React 19 + Vite),
`packages/contracts` (shared Zod schemas), `packages/ui` (design tokens and primitives).

**Endpoints**
- `GET /api/health` — status, version, commit, startedAt
- `GET /api/meta` — name, version, commit, build time, current slice, evidence-layer status

**UI** — landing page rendering the live evidence-layer state from `/api/meta`, the claim
boundary, a CSS pipeline diagram, and two deliberately disabled actions.

**Design system** — `packages/ui` with tokens (light and dark) and five primitives:
Button, Badge, Card, Callout, Table. Semantic colour is kept separate from the accent so
"needs attention" never reads as "branded".

**Gates** — lint, typecheck, unit tests, format check, data-size guard, gitleaks. All green.
**29 unit tests** across contracts (8), api (6), ui (9) and web (6).

## Evidence status

Nothing is proven yet beyond that the workspace runs. No Razorpay integration, no detection,
no models. The landing page reports this honestly rather than describing an aspiration.

| Layer | What it will prove | Status |
|---|---|---|
| L1 — integration | The ingestion contract works against the real Razorpay sandbox | not started (Slice 3–4) |
| L2 — scenario compliance | The detector complies with disclosed scenario specifications | not started (Slice 6–9) |
| L3 — benchmark | Precision and recall on labels we did not author | not started (Slice 12) |

## Verified by running, not assumed

- `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm check:format`, `pnpm build` — all pass
- `GET /api/health` returns a payload that parses against the shared contract
- `GET /api/meta` returns the claim, slice and three evidence layers, all `not-started`
- The landing page was loaded in a browser and rendered the evidence table from live API data
- A test asserts no evidence layer can report `ready` before the slice that produces it
- Data guard rejects a 10.5 MB staged file and any path under `data/raw/`
- Data guard passes on a clean tree

## Deferred, with reasons

| Item | Deferred to | Why |
|---|---|---|
| Playwright end-to-end tests | Slice 2 | Slice 1 has a single static page and no routing. Component tests cover it; installing browser binaries to assert a static page renders is not worth the weight. Slice 2 introduces login and protected routes, which is the first thing E2E genuinely tests. |
| Pinning GitHub Actions to commit SHAs | Supply-chain hardening | Fabricated SHAs would break CI. Recorded in ADR-0001. |
| `README.md` | End of project | Deliberately removed; will be written once the claims it makes are all true. The landing page carries the front-door content in the meantime. |

## Known gaps

- `gitleaks` is not installed locally, so the pre-commit hook warns rather than blocks. CI enforces it unconditionally.
- `docs/` is gitignored by decision, so architecture and delivery plans live outside the repository.

## Recent decisions

- `README.md` removed for now; it will be written at the end, once every claim it makes is true.
  The landing page carries the front-door content meanwhile.
- `docs/` is gitignored, so the architecture and delivery plans live outside the repository.
- `apps/web/src/App.test.tsx` deleted — `App` now renders `Landing`, and that behaviour is
  covered by `Landing.test.tsx`. A test asserting a one-line passthrough would be noise.

## Next

Slice 2 — auth and app shell. Session auth with argon2, login page, protected routes, and the
console shell. Login exists because the audit chain needs an actor: an approval with no identity
attached is not an approval.
