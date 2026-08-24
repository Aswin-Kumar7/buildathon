# Current status

Single source of truth for where Sentinel actually stands. Updated with every change.

**Last updated:** 2026-08-24
**Current slice:** 3 — Storefront and Razorpay orders (complete, awaiting tag)
**Latest tag:** `v0.2.0` → `v0.3.0` pending

## Slice progress

| # | Slice | Tag | Status |
|---|---|---|---|
| 0 | Foundation | `v0.0.1` | **done** |
| 1 | Landing page | `v0.1.0` | **done** |
| 2 | Auth and app shell | `v0.2.0` | **done** |
| 3 | Storefront and Razorpay orders | `v0.3.0` | **done** |
| 4 | Webhook ingestion | `v0.4.0` | **next** |
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

**Workspace** — pnpm + Turborepo monorepo. `apps/api` (NestJS, ESM), `apps/web` (React 19 +
Vite, the analyst console), `apps/storefront` (React 19 + Vite, the demo shop that generates
payment events), `packages/contracts` (shared Zod schemas), `packages/ui` (design tokens and
primitives), `packages/db` (Drizzle schema and dual-driver client).

`pnpm dev` runs all three: API on 3001, console on 5173, storefront on 5174.

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
- `GET /api/catalog` — the shop's price list, which is also the server's pricing authority
- `POST /api/orders` — creates a real test-mode Razorpay order and records the request
  context against it. Public by design: shoppers are anonymous.

**UI** — landing page (evidence table read live from the API), login page, protected
`/console` route, and the console shell: sidebar, user identity, permanent `TEST MODE`
badge, sign out. Sidebar sections that are not built render as unavailable with the slice
number that makes them real.

**Storefront** — "Brew & Co", a four-item shop on its own origin. Cart, optional email,
and a Razorpay hosted-checkout button. It exists to be the **sensor**: card details are
entered inside Razorpay's iframe and never touch our code, and the page says so.

**Design system** — light theme only, by decision. Tokens plus five primitives: Button,
Badge, Card, Callout, Table. Semantic colour is kept separate from the accent so "needs
attention" never reads as "branded".

**Gates** — lint, typecheck, unit tests, format check, data-size guard, gitleaks, and
end-to-end. **123 unit tests** (api 79, contracts 13, ui 9, web 12, storefront 10) and
**17 Playwright tests**.

## Security decisions in place

- Session tokens are stored as **SHA-256 hashes**, never plaintext; a database dump yields
  no usable sessions. Asserted by a test.
- **No user enumeration**: an unknown email runs a full argon2 verification against a decoy
  hash, so timing does not leak which accounts exist, and the response is identical to a
  wrong password. Asserted by a test.
- **Double-submit CSRF** — the cookie alone cannot mutate state.
- Rate limiting is database-backed, so it survives a restart.
- Roles (`analyst`, `admin`) enforced by a guard.
- **The client never sends an amount.** `POST /api/orders` takes SKUs and quantities only;
  the server prices the cart from its own catalogue. A checkout that accepts a price from
  the browser can be charged ₹1 for a ₹10,000 order. Asserted from both sides.
- **No raw identifier is stored.** IP, device and email become keyed HMAC-SHA256
  pseudonyms with a `v1:` prefix, and IPv4 is truncated to /24 (IPv6 to /48) *before*
  hashing, so the hash cannot be reversed by trying four billion addresses. The user-agent
  is reduced to a coarse family. Asserted by a test that greps the stored row for the
  original values.
- **An unknown SKU is rejected, not skipped.** Silently dropping it would let a client
  change what it is buying after the price was agreed.
- **Invalid request bodies return 400, not 500** — a global filter for schema rejections.
  Before it, malformed input was reported as a server fault.
- **`X-Forwarded-For` is only believed behind a configured proxy.** Otherwise it is a
  string the caller controls, and the caller could pick a new address per request —
  making one attacker look like thousands of unrelated shoppers.

## Evidence status

Order creation against the real Razorpay sandbox is now proven. Nothing else is: no
webhook ingestion, no detection, no models. The landing page reports this honestly rather
than describing an aspiration.

The proof, run through our own endpoint rather than a hand-written probe: a POST to
`/api/orders` created test-mode order `order_TTbYwLv72hZAOI` (₹897.00, 3 items) and wrote
the matching sensor row to Supabase, whose stored values contain none of the email,
session id, user-agent or address that produced them.

| Layer | What it will prove | Status |
|---|---|---|
| L1 — integration | The ingestion contract works against the real Razorpay sandbox | **order creation proven**; webhook ingestion pending (Slice 4) |
| L2 — scenario compliance | The detector complies with disclosed scenario specifications | not started (Slice 6–9) |
| L3 — benchmark | Precision and recall on labels we did not author | not started (Slice 12) |

## Verified by running, not assumed

- `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm check:format`, `pnpm build` — all pass
- The 16 auth tests pass against **both** PGlite and real Supabase Postgres 17.6
- Both test configs were run with a hostile `DATABASE_URL` exported in the shell and stayed
  on embedded Postgres — the isolation is demonstrated, not assumed
- A real test-mode Razorpay order was created end to end: `order_TTb4KC1ynwyGm2`, ₹499.00,
  status `created`
- Live flow over HTTP: signed-out `/me` returns `null`; login issues a session and CSRF
  token; the cookie authenticates `/me` and the guarded route; a wrong password returns 401
- 17 Playwright tests boot the real API, console and storefront: landing, login,
  redirect-to-intended, route protection, shell, sign out, catalogue rendering, cart
  totals, and session-id persistence across a reload
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

**The test suite wrote its fixtures into the shared database, and the damage was silent.**
`vitest.integration.config.ts` inherited whatever `DATABASE_URL` was in the environment, so
one run created `analyst@test.local` and friends in Supabase. Nothing failed at the time.
What failed was sign-in, days-equivalent later, because demo seeding was written as "seed
only when the user table is empty" — and the table was no longer empty. The symptom was
`Email or password is incorrect`, which is deliberately indistinguishable from a typo, so
it read as an auth bug. Three separate faults, one visible symptom:

1. Both vitest configs now pin `DATABASE_URL: ''`, and the integration config reads
   `INTEGRATION_DATABASE_URL` instead. Demonstrated by running both suites with a hostile
   `DATABASE_URL` exported.
2. Seeding is idempotent per email rather than gated on an empty table. One stray row can
   no longer disable it. Regression test added.
3. The end-to-end suite forces embedded Postgres, so it can neither be defeated by state
   it did not create nor leave any behind. Verified by counting rows before and after.

**Playwright waited for the wrong service.** `webServer.url` pointed at Vite, which answers
in under a second, while the API still had a database connection and two argon2 hashes
ahead of it. Tests began against an API that was not listening and reported six failures
that looked exactly like application bugs. It now waits on `/api/health` and a global
setup waits for both Vite servers.

**Turbo strips the environment by default.** Setting `DATABASE_URL` for the Playwright web
server had no effect, because Turbo 2 runs tasks in strict env mode and passes through only
what is declared. The variable reached Turbo and stopped there, while the API read the real
value out of `.env` — so the override appeared to be ignored for no reason. Fixed with
`passThroughEnv` on the `dev` task.

**A stale dev server is indistinguishable from a broken one.** A background API left on
port 3001 meant Turbo's own API could not bind, and the suite silently tested week-old
code. Worth checking the port before believing a failure.

**`z.coerce.boolean()` reads the string "false" as true.** `.env` said `TRUST_PROXY=false`
and the running server was trusting `X-Forwarded-For` from anyone. Nothing failed, no test
covered it, and the setting read correctly to anyone skimming the file — the value was
right and the parser was wrong. Every boolean from the environment is now parsed from an
explicit set, and an unrecognised value is rejected at startup rather than guessed at.

## Recent decisions

- `README.md` removed for now; it will be written at the end, once every claim it makes is
  true. The landing page carries the front-door content meanwhile.
- `docs/` is gitignored, so the architecture and delivery plans live outside the repository.
- Light theme only — a single committed look removes a class of contrast bugs and keeps
  every screenshot and recording consistent.
- Demo users (`analyst@sentinel.local` / `sentinel-demo`, and an admin equivalent) are
  seeded on every non-production boot, idempotently per email, so a reviewer can sign in to
  a fresh clone.
- The shop is a separate application on its own origin rather than a route in the console.
  It is untrusted, public and anonymous; the console is none of those. Keeping them apart
  means no shared session, no shared cookie and no route that has to remember which it is.
- Razorpay is called directly over `fetch` rather than through the official SDK. One
  endpoint, four fields, basic auth — and the failure modes stay visible instead of being
  smoothed into something harder to read when a demo breaks.
- Amounts are integer paise everywhere, converted to rupees only for display.
- The repository is private until submission day.

## Known gaps

- `gitleaks` is not installed locally, so the pre-commit hook warns rather than blocks. CI
  enforces it unconditionally.
- GitHub Actions are referenced by tag, not pinned to commit SHAs. Recorded in ADR-0001.
- No Docker locally. Supabase covers the real-Postgres need; Cloud Run is the deployment
  target, which will shape how the Slice 4 worker runs (always-on instance versus
  trigger plus scheduled sweep).
- The Supabase password was pasted into a chat log and should be rotated.
- `RAZORPAY_WEBHOOK_SECRET` is still empty. Slice 4 cannot start without it.
- Three fixture users (`analyst@test.local`, `admin@test.local`, `ratelimit@test.local`)
  and ~43 login-attempt rows are still sitting in Supabase from the test run described
  above. They are harmless now that seeding no longer depends on an empty table, and they
  were left in place rather than deleted without asking.
- The storefront's checkout cannot be driven end to end by an automated test: completing a
  payment means interacting with Razorpay's hosted iframe on their domain. Covered up to
  the handover point; the rest needs a person, or the webhook replay arriving in Slice 4.

## Next

Slice 4 — webhook ingestion. Receive `payment.captured`, `payment.failed` and
`order.paid`, verify the HMAC signature, respond inside Razorpay's 5-second contract, and
persist idempotently under at-least-once delivery with no ordering guarantee. Then join
each event to the checkout session recorded in Slice 3 — the point at which the detector
finally has both halves: what Razorpay saw, and who was asking.

Blocked on `RAZORPAY_WEBHOOK_SECRET`.
