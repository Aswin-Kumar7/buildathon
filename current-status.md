# Current status

Single source of truth for where Sentinel actually stands. Updated with every change.

**Last updated:** 2026-08-24
**Current slice:** 2 — Auth and app shell (complete, awaiting tag)
**Latest tag:** `v0.1.0` → `v0.2.0` pending

## Slice progress

| # | Slice | Tag | Status |
|---|---|---|---|
| 0 | Foundation | `v0.0.1` | **done** |
| 1 | Landing page | `v0.1.0` | **done** |
| 2 | Auth and app shell | `v0.2.0` | **done** |
| 3 | Storefront and Razorpay orders | `v0.3.0` | **next** |
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

**Workspace** — pnpm + Turborepo monorepo. `apps/api` (NestJS, ESM), `apps/web` (React 19 + Vite),
`packages/contracts` (shared Zod schemas), `packages/ui` (design tokens and primitives),
`packages/db` (Drizzle schema and dual-driver client).

**Database** — two drivers, selected by whether `DATABASE_URL` is set:

| Driver | When | Used for |
|---|---|---|
| PGlite (Postgres compiled to WebAssembly, in-process) | `DATABASE_URL` absent | Development, the whole test suite, and the credential-free demo path |
| postgres.js against Supabase | `DATABASE_URL` set | Real-server behaviour; required for Slice 4's concurrency gate |

All tables live in a dedicated **`sentinel` schema**, never `public`. Supabase exposes
`public` through PostgREST, so an authentication table created there would be reachable
over HTTPS. Verified: `public` holds zero tables.

**Endpoints**
- `GET /api/health` — status, version, commit, startedAt
- `GET /api/meta` — claim, current slice, evidence-layer status
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/auth/session-check`, `POST /api/auth/admin-check` — exist so the guard, CSRF and
  role paths are covered by real routes

**UI** — landing page (evidence table read live from the API), login page, protected
`/console` route, and the console shell: sidebar, user identity, permanent `TEST MODE`
badge, sign out. Sidebar sections that are not built render as unavailable with the slice
number that makes them real.

**Design system** — light theme only, by decision. Tokens plus five primitives: Button,
Badge, Card, Callout, Table. Semantic colour is kept separate from the accent so "needs
attention" never reads as "branded".

**Gates** — lint, typecheck, unit tests, format check, data-size guard, gitleaks, and
end-to-end. **58 unit tests** (contracts 13, api 24, ui 9, web 12) and **12 Playwright
tests**.

## Security decisions in place

- Session tokens are stored as **SHA-256 hashes**, never plaintext; a database dump yields
  no usable sessions. Asserted by a test.
- **No user enumeration**: an unknown email runs a full argon2 verification against a decoy
  hash, so timing does not leak which accounts exist, and the response is identical to a
  wrong password. Asserted by a test.
- **Double-submit CSRF** — the cookie alone cannot mutate state.
- Rate limiting is database-backed, so it survives a restart.
- Roles (`analyst`, `admin`) enforced by a guard.

## Evidence status

Nothing is proven yet beyond that the workspace and auth run. No Razorpay integration, no
detection, no models. The landing page reports this honestly rather than describing an
aspiration.

| Layer | What it will prove | Status |
|---|---|---|
| L1 — integration | The ingestion contract works against the real Razorpay sandbox | not started (Slice 3–4) |
| L2 — scenario compliance | The detector complies with disclosed scenario specifications | not started (Slice 6–9) |
| L3 — benchmark | Precision and recall on labels we did not author | not started (Slice 12) |

## Verified by running, not assumed

- `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm check:format`, `pnpm build` — all pass
- The 14 auth tests pass against **both** PGlite and real Supabase Postgres 17.6
- Live flow over HTTP: signed-out `/me` returns `null`; login issues a session and CSRF
  token; the cookie authenticates `/me` and the guarded route; a wrong password returns 401
- 12 Playwright tests boot the real API and web app: landing, login, redirect-to-intended,
  route protection, shell, sign out
- Supabase `public` schema contains zero tables
- Data guard rejects a 10.5 MB staged file and any path under `data/raw/`

## Lessons that cost time

**Decorator metadata bit three times, in three different transforms.** NestJS resolves
constructor dependencies from `design:paramtypes` emitted at runtime:

1. Vitest transforms with esbuild, which does not emit it — dependency injection resolved
   to `undefined`. Fixed with `unplugin-swc`.
2. eslint's `consistent-type-imports` autofix rewrote `import { AuthService }` to
   `import type`, erasing the runtime value. The rule is now disabled for `apps/api`.
3. The dev server ran on tsx (esbuild again), so **the test suite was green while the
   application returned 500 on every auth route**. Fixed with `@swc-node/register`.

The third is the one to remember: passing tests were not sufficient evidence that the
system worked. That is exactly why the end-to-end suite now boots the real stack, and why
Slice 4's ingestion gate must be proven the same way.

## Recent decisions

- `README.md` removed for now; it will be written at the end, once every claim it makes is
  true. The landing page carries the front-door content meanwhile.
- `docs/` is gitignored, so the architecture and delivery plans live outside the repository.
- Light theme only — a single committed look removes a class of contrast bugs and keeps
  every screenshot and recording consistent.
- Demo users (`analyst@sentinel.local` / `sentinel-demo`, and an admin equivalent) are
  seeded only when the user table is empty, so a reviewer can sign in to a fresh clone.
- The repository is private until submission day.

## Known gaps

- `gitleaks` is not installed locally, so the pre-commit hook warns rather than blocks. CI
  enforces it unconditionally.
- GitHub Actions are referenced by tag, not pinned to commit SHAs. Recorded in ADR-0001.
- No Docker locally. Supabase covers the real-Postgres need; Cloud Run is the deployment
  target, which will shape how the Slice 4 worker runs (always-on instance versus
  trigger plus scheduled sweep).
- The Supabase password was pasted into a chat log and should be rotated.

## Next

Slice 3 — storefront and Razorpay orders. A demo checkout that creates real test-mode
orders and captures the request context Razorpay's webhooks do not carry: hashed IP,
device and session, keyed on `order_id`. That join is the sensor the whole detector
depends on.
