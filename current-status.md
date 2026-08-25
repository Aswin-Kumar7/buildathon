# Current status

Single source of truth for where Sentinel actually stands. Updated with every change.

**Last updated:** 2026-08-25
**Current slice:** 7 — Features, tiles and sketches (complete, awaiting tag)
**Latest tag:** `v0.6.0` → `v0.7.0` pending

## Slice progress

| # | Slice | Tag | Status |
|---|---|---|---|
| 0 | Foundation | `v0.0.1` | **done** |
| 1 | Landing page | `v0.1.0` | **done** |
| 2 | Auth and app shell | `v0.2.0` | **done** |
| 3 | Storefront and Razorpay orders | `v0.3.0` | **done** |
| 4 | Webhook ingestion | `v0.4.0` | **done** |
| 5 | Canonical state | `v0.5.0` | **done** |
| 6 | Scenario corpus and replay | `v0.6.0` | **done** |
| 7 | Features, tiles and sketches | `v0.7.0` | **done** |
| 8 | Rules to incidents | `v0.8.0` | **next** |
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
primitives), `packages/db` (Drizzle schema and dual-driver client), `packages/corpus`
(seeded scenario generation), `packages/detect` (pure feature computation, decay, tiles and
sketches).

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
- `POST /api/webhooks/razorpay` — the delivery endpoint. Unauthenticated by necessity
  (Razorpay holds no session with us) and authenticated by HMAC over the raw body.
- `GET /api/ingestion/metrics` — what the system health page reads. Session required.
- `GET /api/attempts`, `GET /api/attempts/:orderId` — payment attempts resolved from event
  history, with the checkout context joined on. Session required.
- `GET /api/replay`, `POST /api/replay`, `DELETE /api/replay` — the scenario catalogue and the
  local replay harness. Session required, and refused outright in production.

**UI** — landing page (evidence table read live from the API), login page, protected
`/console` route, and the console shell: sidebar, user identity, permanent `TEST MODE`
badge, sign out. Sidebar sections that are not built render as unavailable with the slice
number that makes them real.

**Storefront** — "Brew & Co", a four-item shop on its own origin. Cart, optional email,
and a Razorpay hosted-checkout button. It exists to be the **sensor**: card details are
entered inside Razorpay's iframe and never touch our code, and the page says so.

**Ingestion** — the transactional inbox. A delivery is verified, encrypted, inserted and
committed *before* it is acknowledged; a worker then derives the redacted canonical event,
retrying and dead-lettering on failure.

| Stage | What happens | Why in this order |
|---|---|---|
| Verify | HMAC-SHA256 over the exact bytes received | Re-serialising reorders keys, and the digest stops matching |
| Encrypt | Per-event data key, wrapped by a key held outside the database | A database dump alone decrypts to nothing |
| Insert | Unique constraint on the event id; a repeat increments a counter | At-least-once delivery cannot become two rows |
| Commit | — | A 2xx before this loses the event if the process dies: Razorpay never resends |
| Acknowledge | 200 | — |
| Drain | Derive the redacted canonical event, mark processed | Nothing downstream ever reads the encrypted payload |

**Canonical payment state** — attempts reconstructed from the event history rather than
mutated as events arrive.

The resolved status of an attempt is the **highest-ranked status in its event set**, not the
status of the last event to arrive. `max` over a set does not care how the set was assembled,
so duplicates, reordering and replay after a restart all land in the same place — the
property is true by construction rather than by careful sequencing. Two permutation tests
assert it over all 24 orderings of a four-event history.

`failed` ranks below `authorized` deliberately, so a payment that failed and was later
captured resolves to captured. That is not a contradiction being papered over: it is what a
UPI late confirmation looks like, and the failure stays on the record so the recovery is
legible.

An order is not a payment. A shopper declined once who retries produces two payments under
one order, and `recovered` only exists at that level — no single attempt can see it. That
flag is what the console is built around: a customer who had a bad minute and an attacker
produce the same two red dots, and collapsing both into "two failed payments" is how a
detector ends up accusing people of having a bank that was briefly down.

A checkout with no terminal event past the allowed-lateness bound is recorded as
**unresolved**, never as a failure. Inventing a failure that never happened is the last thing
a system keyed on failure counts should do.

**Attempt timeline** — the console page. Per order: each attempt on a vertical spine, coloured
by outcome, with the gap the shopper waited, the failure reason kept visible on recovered
attempts, and the session, device and network fingerprints the webhooks cannot carry.

**Scenario corpus** — eight labelled traffic families in `packages/corpus`, generated from
specifications committed before any detector exists to be tuned against them. Seeded, so a
family plus a seed reproduces the same events byte for byte; a widened range shows up as a
changed spec hash in a reviewable diff rather than as noise in a thousand regenerated events.

The corpus exists to make one thing checkable: **raw failure count cannot separate an attack
from an operational problem.**

| Failures | Family | Class | Approval | Sessions |
|---|---|---|---|---|
| 74 | `attack_distributed` | attack | 5% | 37 |
| 61 | `attack_loud` | attack | 3% | 1 |
| 43 | `attack_low_amplitude` | attack | 0% | 3 |
| **36** | `retry_storm` | **operational** | 25% | 2 |
| **29** | `gateway_outage` | **operational** | 51% | 59 |
| 20 | `flash_sale` | benign | 89% | 165 |
| 5 | `customer_error` | benign | 90% | 40 |

A legitimate dunning storm produces more failures than one of the attacks. Blocking it would
stop a merchant collecting money it is owed; blocking the outage would punish customers for
the acquirer being down. Neither is separable by counting.

**Replay** — writes a committed scenario into the inbox and lets the real path take it: the
same encryption, drain, redaction and state resolution. There is deliberately **no
configurable HTTP target** — a replay tool that can be pointed at a hostname is a load
generator, and one shipped in a payments repository is a load generator aimed at somebody
else's checkout.

Replayed rows carry `source = 'replay'` from the inbox through to the canonical event, and
the health page reports them beside the real figure rather than folded into it. Refused
outright when `NODE_ENV=production`.

**Features** — `packages/detect` holds the computation, with no database, no clock and no
framework in it. `computeFeatures` takes the observations, the entity and an explicit `asOf`,
and returns a vector; a function that asked the system what time it was could not be replayed,
and a decision that cannot be replayed cannot be explained.

Rates decay by half-life rather than sliding over a window. A window has a cliff — the same
traffic reads differently either side of an arbitrary boundary — and decayed counters merge,
which is what makes minute tiles work at all.

Distinct counts come from a HyperLogLog at precision 12: 4 KB, 1.6% standard error. It is
used for **candidate discovery only**. The API computes twice on purpose — once without
confirming, cheaply, to rank every entity; then again for the survivors with the counts
re-derived exactly. Every sketch value carries its own error bound and its confirmation, so
nothing can reach a decision as an estimate that looked like a fact.

Minute tiles make the same numbers computable incrementally. The property that matters is
that merging tiles equals folding the events directly — asserted per scenario family against
the committed corpus, not against data written to make it easy — and that the online and
offline paths stay within the skew bucketing implies (under 7%, measured).

**Feature inspector** — `/console/features`. For each entity it shows every feature, the
window and half-life it was computed over, how fresh it is, and for the sketch-derived counts
the estimate with its bound *beside* the exact confirmed figure, never instead of it. Real and
replayed traffic are selectable and separate, for the same reason the health page keeps them
apart.

When nothing has arrived within a whole window, it evaluates as of the last thing that did and
says so on the page. A replayed scenario carries the timestamps it was recorded with, so its
rates are real but historical; presenting them as live would be a lie by omission.

**System health page** — ingestion rate, duplicate rate, queue depth, oldest waiting event,
dead-letter depth, late-event count, and the watermark. It states whether ingestion is
configured *before* showing any number, because an unconfigured webhook and a healthy idle
one produce identical zeroes.

**Design system** — light theme only, by decision. Tokens plus five primitives: Button,
Badge, Card, Callout, Table. Semantic colour is kept separate from the accent so "needs
attention" never reads as "branded".

**Gates** — lint, typecheck, unit tests, format check, data-size guard, gitleaks, and
end-to-end, plus a payload-leak guard. **373 unit tests** (api 231, web 52, detect 38,
corpus 20, contracts 13, storefront 10, ui 9), **109 integration tests** and **29 Playwright
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
- **Webhook payloads are envelope-encrypted at rest.** A fresh random data key encrypts
  each payload; the long-lived key encrypts only that data key. It therefore encrypts a
  few hundred bytes over its whole life rather than gigabytes, and rotating it means
  rewrapping one small key per row instead of re-encrypting every payload ever received.
  AES-256-GCM throughout, so a tampered row fails authentication rather than decrypting to
  plausible rubbish.
- **Decryption failures are indistinguishable from each other.** "Wrong key" and "tampered
  ciphertext" return the same message, because telling a caller which is which is a
  decryption oracle. Asserted by a test.
- **The canonical event is a whitelist, not a blacklist.** A field is copied across only if
  it is named, so a customer-associated field appearing in a future Razorpay payload is
  excluded by default rather than leaking until somebody notices. Email, contact, card last
  four, VPA, cardholder name and account id never leave the encrypted blob.
- **`last4` is deliberately not stored** even though it is available. For a tokenised card
  it is the token's last four rather than the card's, so it identifies a person without
  even being the signal it appears to be.
- **A signature is compared in constant time**, and a malformed one is rejected rather than
  throwing — otherwise a short header becomes a 500 that tells the sender their input was
  interestingly wrong.
- **`check:payload` greps output directories** for payload field names and for anything
  shaped like an email address, an Indian phone number or a card number. Verified by
  planting a leak and watching it fail.

## Evidence status

Order creation and webhook ingestion are proven. Detection and the models are not — nothing
reads the events yet. The landing page reports this honestly rather than describing an
aspiration.

**Order creation**, through our own endpoint rather than a hand-written probe: a POST to
`/api/orders` created test-mode order `order_TTbYwLv72hZAOI` (₹897.00, 3 items) and wrote
the matching sensor row to Supabase, whose stored values contain none of the email,
session id, user-agent or address that produced them.

**Webhook ingestion**, against the running API and real Supabase Postgres:

| Delivered | Result |
|---|---|
| Wrong signature | 401, nothing persisted |
| Valid signed event | 200, one row, encrypted |
| The same event again | 200, `stored: false`, `delivery_count` 2, still one row |

The drain then derived the canonical event in 550 ms. Checking the stored inbox and
canonical rows for the values that produced them: the email, phone number, card last four,
cardholder name and account id are all absent. The order id is present, which is the point
— it is the join key to the checkout session, and it identifies an order rather than a
person.

**Canonical state, resolved from the real history.** The deployed instance's own events, read
back through `/api/attempts`:

```
order_TTyyheY7fRMZnW   outcome paid   recovered true   failureCount 1
  pay_TTyzcANZB9mSVn   failed     Visa        international_transaction_not_allowed
  pay_TTz2PHRSa5mdZp   captured   Visa/DCBL   3 events
  sensor  session e9487855 · device 5af9f588 · network 9ecb5789 · chrome
```

Not a fixture: a real declined card and a real retry, resolved into one recovered order with
the failure still on the record and the storefront's context joined on the order id.

**Webhook ingestion from Razorpay itself**, proven on the deployed instance. A live test
payment produced a complete sequence against one order:

```
order_TTyyheY7fRMZnW
  payment.failed  ->  payment.authorized  ->  payment.captured  ->  order.paid
```

Five events stored, five canonical, none pending, none dead-lettered. Drain times 364 ms,
262 ms and 80 ms. Signature verified against the raw bytes, payload encrypted, committed
before acknowledgement, redacted on the way out — the card network survived, the card number,
cardholder and email did not.

That first `payment.failed` carries `error_reason: international_transaction_not_allowed`,
`error_source: business`, `error_step: payment_initiation` — a rejection Razorpay made before
any bank was involved. The retry then succeeded on the same order, which is exactly the
`failed -> captured` recovery Slice 5 has to render as mitigating rather than as two
problems. It is now a real trace rather than a fixture.

| Layer | What it will prove | Status |
|---|---|---|
| L1 — integration | The ingestion contract works against the real Razorpay sandbox | **order creation and webhook ingestion proven**; a delivery from Razorpay itself still needs the webhook secret |
| L2 — scenario compliance | The detector complies with disclosed scenario specifications | not started (Slice 6–9) |
| L3 — benchmark | Precision and recall on labels we did not author | not started (Slice 12) |

## Verified by running, not assumed

- `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm check:format`, `pnpm check:docker`,
  `pnpm build` — all pass
- The 16 auth tests pass against **both** PGlite and real Supabase Postgres 17.6
- Both test configs were run with a hostile `DATABASE_URL` exported in the shell and stayed
  on embedded Postgres — the isolation is demonstrated, not assumed
- A real test-mode Razorpay order was created end to end: `order_TTb4KC1ynwyGm2`, ₹499.00,
  status `created`
- Live flow over HTTP: signed-out `/me` returns `null`; login issues a session and CSRF
  token; the cookie authenticates `/me` and the guarded route; a wrong password returns 401
- 19 Playwright tests boot the real API, console and storefront: landing, login,
  redirect-to-intended, route protection, shell, sign out, system health, catalogue
  rendering, cart totals, and session-id persistence across a reload
- Deduplication survives a process restart, proven against a file-backed embedded Postgres
  rather than an in-memory one that would have forgotten everything on close and passed for
  the wrong reason
- Dead-lettering after three attempts, and a dead row can be put back in the queue
- The payload-leak guard was verified by planting a leak and watching it fail
- Supabase `public` schema contains zero tables
- Data guard rejects a 10.5 MB staged file and any path under `data/raw/`
- Tile-merge equals the naive computation for four scenario families drawn from the committed
  corpus, and the online/offline decay skew stays under 7%
- The HyperLogLog was caught reporting 34 distinct values for 100. FNV-1a does not avalanche
  in its high bits for short similar strings — `card_1`, `card_2` — and the register index is
  taken from exactly those bits. Fixed with a murmur3 finaliser and held to its error bound
  against the corpus
- The features integration suite drains the inbox to exhaustion rather than once. A single
  pass claims 50 events, fewer than three scenarios write, and the inbox drains in arrival
  order — so the first version tested one session and reported green

## Corrections

**`bank` is not an infrastructure failure.** `infrastructureFailureShare` — the feature whose
whole job is telling an acquirer outage apart from an attack — originally counted failures
Razorpay attributed to either the gateway *or* the bank. But Razorpay attributes an issuer
refusing a card to the bank, so `bank` is the dominant source in every attack family in the
corpus: 39 of 61 failures in `attack_loud`, all 36 in `retry_storm`. The feature read 1.0 for
a dunning run, which is precisely the confusion it exists to prevent. Only `gateway` names a
component that failed rather than a card that was refused.

It survived the unit tests because they compared the two extremes — `gateway` against
`customer` — and never the ambiguous middle. It is now asserted across six scenario families
against the corpus, so widening the definition fails there rather than in a console later.

**Both container images had been unbuildable since Slice 6.** The Dockerfiles copy workspace
manifests one line at a time, before the source arrives, so that `pnpm install` caches against
dependency changes rather than every edit. `packages/corpus` was never added to that list, so
it got no `node_modules` — and then `pnpm build`, which built the whole workspace, compiled it
anyway and died on `Cannot find type definition file for 'node'`. The storefront image failed
on a package it does not even ship. `packages/detect` would have done it again.

Three fixes, and a check so it cannot recur silently. Both images now copy every workspace
manifest. The storefront builds only its own dependency graph — contracts, ui, storefront —
instead of the entire monorepo. The API's runtime stage copies the compiled output of
`corpus` and `detect`, which it imports and previously would not have found: `pnpm install
--prod` creates the symlink, so that failure survives the build and appears as "cannot find
module" when the container starts. `scripts/check-docker.mjs` now fails the gate for either
mistake, in milliseconds and without Docker.

Verified by reproducing both image builds locally stage by stage — manifests only, install,
source, build — since Docker is not available on this machine. Both now build, and the
compiled API resolves `@sentinel/detect` and `@sentinel/corpus` from their `dist`.

**Three packages were shipping their tests into production.** `corpus`, `db` and `detect`
compiled `*.test.ts` into `dist`; `contracts` had always excluded them. Mostly dead weight,
except that `detect`'s tile test imports `@sentinel/corpus` — a devDependency a `--prod`
install does not put in the image — so it was a file in a production container that would
throw if anything ever loaded it.

**The payload-leak guard was reporting leaks that were not leaks.** It read Playwright trace
zips as UTF-8 and ran regexes over them, which matched the uncompressed filename table:
`page@<hash>-<ms>.jpeg` is not an email address and a millisecond timestamp is not a card
number. Meanwhile the actual entries are deflated, so anything real inside was invisible —
the check was failing the gate on noise while providing none of the protection it claimed.
Zips are no longer scanned as text, and card numbers are now confirmed by Luhn rather than by
shape. Verified in both directions: a planted `4111 1111 1111 1111` still fails the gate, a
13-digit timestamp no longer does.


**`payment.failed` does fire on a first-attempt failure.** Recorded from research as a
constraint, and used as part of the justification for the storefront sensor. The deployed
instance received one for a rejection that never reached a bank: `error_step:
payment_initiation`, `error_source: business`. The sensor is still justified — webhooks carry
no IP, device or session, which is the whole reason it exists — but not for that reason.

**Processing latency was measured across two clocks.** `received_at` and `processed_at` were
each read from a container's own clock, minutes apart and possibly on different instances,
and then subtracted. A live event came back at **-195 ms** — processed before it arrived —
which a single NTP correction is enough to produce. Both timestamps now come from the
database, which cannot disagree with itself, and the metric has a floor at zero because rows
written before the fix are still in the table. Two regression tests.

**The running cost on Cloud Run was understated at $10-15 a month.** With CPU always
allocated it is billed for every second the instance exists rather than only during requests,
which put it nearer $45-55. Moot now that the deployment is on Azure, but the arithmetic was
wrong, not the conclusion.

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

**The unit suite cannot catch a driver difference, and one was waiting.** The metrics query
interpolated a `Date` straight into a `sql` template. PGlite coerces it; postgres.js throws,
because a bare parameter has no column to infer a type from. Every unit test passed — they
all run on PGlite — and the system health page hung on "Reading ingestion metrics…" the
moment it met a real server. Fixed by passing an ISO string with an explicit
`::timestamptz` cast, and the rest of the codebase was swept for the same shape. The
general lesson: the embedded database is the right default and is not a substitute for
running against the real one before believing a query works.

**Playwright killed turbo and turbo's children survived.** Every end-to-end run left an API
holding port 3001. The next run then found a server answering on 3001 that it had not
started, `pnpm dev` failed to bind, and the suite tested stale code — which cost real time
twice before the pattern was obvious. Fixed with `gracefulShutdown` on the web server, and
the global setup now says so explicitly when the API answers but a Vite port does not.

**The shared packages shipped raw TypeScript, and nothing noticed until production.**
`packages/contracts` and `packages/db` pointed `main` at `./src/index.ts`. Vite and
`@swc-node/register` transpile on the fly, so every test, every dev server and the whole
end-to-end suite were green — while `node dist/main.js` could not load the application at
all. Found by running the built output before writing the Dockerfile rather than after
deploying it. Both packages now compile to `dist` and point there, and `turbo dev` depends
on `^build`.

**`z.coerce.boolean()` reads the string "false" as true.** `.env` said `TRUST_PROXY=false`
and the running server was trusting `X-Forwarded-For` from anyone. Nothing failed, no test
covered it, and the setting read correctly to anyone skimming the file — the value was
right and the parser was wrong. Every boolean from the environment is now parsed from an
explicit set, and an unrecognised value is rejected at startup rather than guessed at.

## Recent decisions

**No Redis, though the plan calls for it.** Rolling counters in Redis buy latency, not
correctness, and every property that makes this slice worth having — tile-merge equalling the
naive computation, sketch error bounds, online/offline parity — holds without it. It would
also add roughly $16 a month to a $100 budget. The tile structure is the part that would have
to be right for Redis to help later; that part exists and is tested.

**Features are computed as of a moment, never from a clock.** `asOf` is a parameter, and
observations after it are dropped. It is the difference between a decision that can be
explained six weeks later and one that can only be re-asserted.

**The inspector separates real traffic from replayed traffic.** Found by running the E2E
suite: the storefront specs put live payments through the same server, and because the corpus
carries timestamps from months ago, a single live attempt anchored the window to now and hid
every replayed scenario behind it. Merging the two was also inconsistent with the health page,
which has always counted them apart.


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
- No Docker locally, so the two Dockerfiles are unverified until the first Cloud Build run.
  The production **output** is verified — `node dist/main.js` was run with NODE_ENV=production
  against real Postgres, serving the console and answering the API — so what remains
  untested is the image build, not the thing it builds.
- The Supabase password was pasted into a chat log and should be rotated.
- `RAZORPAY_WEBHOOK_SECRET` is still empty, so the webhook endpoint refuses every delivery
  and the health page says so. The machinery is proven with a locally generated secret;
  what is missing is a delivery that originated from Razorpay.
- No public HTTPS endpoint yet, so Razorpay has nowhere to deliver to. A tunnel covers
  local verification; Cloud Run is the real answer.
- **Schema changes are applied as idempotent DDL, not migrations.** `CREATE TABLE IF NOT
  EXISTS` never alters a table that already exists, so adding a column does nothing to a
  database created before it, and the failure appears at query time rather than at boot.
  Survivable while the schema only grows; drizzle-kit has to take over the first time a
  column changes type or is dropped.
- The drain runs inside the API process on a timer. That is correct for now and wrong at
  scale; the architecture's `apps/worker` extraction is deliberately deferred until the
  Cloud Run shape is settled.
- **The always-on Cloud Run instance costs roughly $45–55 a month** — about $100 across the
  planned two-month run, out of $300 of trial credits. It exists only because the drain is a
  `setInterval` and Cloud Run gives an idle instance no CPU. A Cloud Scheduler job calling a
  drain endpoint would allow scale-to-zero and cost almost nothing, at the price of a cold
  start on the webhook path. That is the right change for a long-lived deployment and the
  wrong one for a two-month demo, so the timer stays. An earlier estimate of $10–15 was
  wrong: with CPU always allocated, it is billed for every second the instance exists rather
  than only during requests.
- Three fixture users (`analyst@test.local`, `admin@test.local`, `ratelimit@test.local`)
  and ~43 login-attempt rows are still sitting in Supabase from the test run described
  above. They are harmless now that seeding no longer depends on an empty table, and they
  were left in place rather than deleted without asking.
- The storefront's checkout cannot be driven end to end by an automated test: completing a
  payment means interacting with Razorpay's hosted iframe on their domain. Covered up to
  the handover point; the rest needs a person, or the webhook replay arriving in Slice 4.

## Deployment

Two Azure Container Apps in `centralindia`: `sentinel-api` (API + console, same origin as the
session cookie it issues) and `sentinel-shop` (the storefront, deliberately on its own origin
— an anonymous public page must not share a security boundary with an authenticated
session). The deployment runbook was removed once the environment was live; it is in git
history at `infra/README.md` if the environment ever has to be rebuilt, and the settings that
matter are listed below.

**Azure, after Google Cloud proved unavailable.** The GCP project belonged to someone else
and its billing account turned out to be closed — `billingEnabled: true` on the project while
`open: false` on the account, so every free call succeeded and everything that provisioned
failed. Azure for Students gave a subscription with $100 of credit and no card requirement,
which removed the dependency on somebody else's payment method entirely.

It is also far cheaper. Container Apps bills an idle replica at roughly a third of the active
rate and allows 0.25 vCPU; Cloud Run with CPU always allocated bills the full rate regardless
and forces a minimum of one vCPU. **Roughly $10–19 a month including the registry, against
$45–55 on Cloud Run**, for the same always-on shape.

PGlite is now imported lazily rather than at module load. It carries a WebAssembly build of
Postgres, and a production container that only ever talks to a real server has no reason to
hold it in memory — which is what makes 0.5 GiB a reasonable size to run in.

**GitHub deploys to Azure, authenticated by OpenID Connect** — GitHub presents a signed claim
naming this repository and branch, Azure trusts it directly, and no long-lived credential
exists. The Google attempt used a service-account key, which passed through a chat transcript
and a Downloads folder before it was ever used; this arrangement has nothing to leak.

`deploy.yml` passes only `--image`. Configuration lives on the app and is set by the
dispatched `configure` step, so a push to `main` can never quietly change how production is
configured.

The gate lives in `verify.yml` and is called by both `fast.yml` and `deploy.yml`, with every
deploy job waiting on it. The first version did not do this: both workflows fired on a push
to main and neither waited for the other, so a commit could deploy while its own tests were
still failing beside it.

## Next

Slice 8 — rules to incidents. The first layer that reaches a conclusion rather than presenting
a number: thresholds over the feature vectors, grouped into an incident with the evidence that
produced it attached, so a reader can see why it fired and not only that it did.

Previously: Slice 7 — features, tiles and sketches. The first layer that reads the canonical
events for something other than display: decayed counters keyed on the correlations the sensor
provides, computed as of decision time so a decision can be replayed and reproduced. Sketches
find candidates, exact counts confirm them, and the inspector shows both so nobody mistakes
one for the other.

Previously: Slice 6 — scenario corpus and replay. Seeded generation of the eight scenario families, so
the detector can be exercised at volume without touching the network, and the credential-free
demo path gets something to replay. Scenario definitions and seed hashes are pre-registered
before any tuning, which is what stops the corpus being quietly shaped to flatter the
detector.

Previously: Slice 5 — canonical payment state. Attempts reconstructed from immutable event history
rather than mutated in place, so the same events in any order, with any duplicates, across
a restart, resolve to the same thing. `failed → captured` is a **valid** transition — it is
what a UPI retry looks like — and the console must render it as mitigating evidence rather
than as two problems. Missing, late or inconsistent data becomes a typed exception record,
never a silent guess.

Then the attempt timeline: the signature visual, and the first screen that shows a real
payment's history including a recovered failure shown as recovery.
