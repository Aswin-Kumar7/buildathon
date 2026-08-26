# Current status

Single source of truth for where Sentinel actually stands. Updated with every change.

**Last updated:** 2026-08-26
**Current slice:** 15 — Performance & graceful degradation: criticality taxonomy, load test, live shedding (built + measured)
**Latest tag:** `v0.14.0` → `v0.15.0` pending

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
| 8 | Rules to incidents | `v0.8.0` | **done** |
| 9 | Arbitration and suppression | `v0.9.0` | **done** |
| 10 | Policy, approval and containment | `v0.10.0` | **done** |
| 11 | Audit chain | `v0.11.0` | **done** |
| 12 | Model A — real labelled benchmark | `v0.12.0` | **done** |
| 13 | Model B — incident classifier, served | `v0.13.0` | **done** |
| 14 | Narration — claim-id-only, bound in code | `v0.14.0` | **done** |
| 15 | Performance & graceful degradation | `v0.15.0` | **built + measured** |
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

**Detection** — two tiers, both pure, both in `packages/detect`.

*Tier 1, deterministic rules.* Nine of them, over a feature vector. Six can incriminate;
**three can only mitigate** — a recovered order, failures Razorpay blamed on its own gateway,
and cards being retried rather than walked. Mitigations carry negative weight and sit in the
same evidence list, because a rule set that can only accuse will eventually accuse a shopper
whose card was declined twice before it worked.

Rules emit **codes and numbers, never prose**. The sentence a person reads is rendered in the
console from those, so a reason can be counted, compared and tested, and cannot drift from what
happened because somebody improved the wording.

A rule that cannot run **abstains and says why**, which is not the same as finding nothing.
"Not enough attempts to judge cadence" is silence; "cadence looks human" is a finding. `card_spread`
abstains outright on an unconfirmed sketch — a decision that can block a payment may rest on the
exact count or on nothing.

*Tier 2, change detection.* EWMA for loud bursts, CUSUM for the quiet persistent case a fixed
threshold cannot reach. Both explain themselves in their own terms: how far past normal, and
after how many minutes of accumulating.

**Scoring** is additive, and every term appears in the explanation. Abstentions widen a
**confidence band** rather than scoring zero — missing information must not read as innocence —
and an incident will not open on a wide band however high the score.

**Thresholds** live in one file with a hash, the same pre-registration idea as the corpus specs.
Every incident records which threshold set judged it, because a score means nothing next to
thresholds nobody can see.

**Incidents** — one episode per entity, not one alert per attempt, keyed on the entity and when
its activity began so a replay reproduces it. Lifecycle `open → under review → contained →
resolved`, plus automatic expiry; `resolved` and `expired` are terminal, and the API refuses an
illegal move with a 400 rather than ignoring it. Every transition records who made it, or names
the system when it was automatic.

A detection pass recomputes scores, never status — one that reset `under_review` to `open` would
throw away an analyst's work each time it ran.

**Arbitration** — five competing explanations rather than one score with subtractions: an
attack, an acquirer outage, a biller's retry schedule, ordinary healthy traffic, and not enough
evidence to say. Each declares what it would expect the traffic to look like and is scored on how
much of that it sees; the winner is reported with the runner-up and the margin between them,
because a narrow win is not a conclusion.

The change that makes it work is `TrafficContext`: **what the rest of the shop was doing.** A
per-entity vector cannot tell an outage from an attack — both are one session failing repeatedly
— and the difference is entirely whether everybody else is failing too. Breadth of failure, the
share belonging to the worst session, and who Razorpay blamed are what separate them.

**Suppression is an argument, not an absence.** An outage or a retry schedule winning does not
merely fail to trigger containment; it argues against it, and the console shows that argument
with the evidence behind it.

**Abstention is an outcome.** When two explanations fit about as well, that is another way of
saying we do not know, and it routes to a person rather than to an action. Containment is also
gated outright on the card counts having been confirmed — the attack case can otherwise reach
the threshold on rate, spread and amount alone, none of which is the count the case is about.

**Nothing requires `payment.downtime.*`.** Those corroborate an outage where they exist and are
never necessary: the case is carried by `error_source` and by how far failure has spread, both
present on every ordinary webhook.

**Policy** — `policy.yaml` at the repository root, parsed at startup, and the API **refuses to
start without it**. A threshold in a function is a decision nobody reviews; a threshold in a
versioned file is a diff somebody has to approve, and the alternative to refusing is running on
defaults nobody chose. Parsing is strict: a missing value is not zero, every problem is reported
at once, and relationships between fields are checked — blocking a payment cannot need less
evidence than asking for another factor.

Every decision records the policy version and a hash of the values, so "why did it do that six
weeks ago" has an answer that does not depend on what the file says today.

**Contain actually contains.** The checkout asks, before opening a Razorpay order, whether the
shopper's session, device or network is under an active block, and refuses if so. Without that
question at the point an attempt is made, `contain` is a row that says "active" and changes
nothing — the action describes itself as "refuse further attempts", and this is where the refusal
happens. The shopper is told nothing about why; the reason lives in the audit trail.

**Five actions, all reversible, all expiring** — `observe`, `step_up`, `contain`, `escalate`,
`release`. That is the constraint the list was written under rather than a property of the
current five, and it is asserted: nothing customer-impacting may exist without an expiry. The
failure mode of a block that never lifts is a shopper who can never pay again while nothing
appears to have gone wrong.

**Containment is never automatic**, whatever the score, and needs two people when the cost of
being wrong is high — which rises as confidence falls, so the less sure the system is, the more
people have to agree. The same person approving twice is refused, which is the entire content of
dual approval.

**The degradation matrix**: if we cannot see clearly, we do not touch a customer. Stale features,
counts that were never confirmed, and an arbitration that abstained each forbid anything the
shopper would notice — and each escalates to a person rather than falling silent, because a
detector that quietly stops protecting anything is worse than one that says so.

**Impact caps and a kill switch.** Ceilings that hold however confident anything is, and one
control that stops everything without a deploy, checked first and unconditionally.

**Expiry runs on a timer and needs nobody.** An action that has to be remembered and undone is
one that will still be in place next month.

**Policy page and simulator** — `/console/policy`. Shows the policy actually loaded, and answers
"what would this have decided?" against incidents that already happened. It saves nothing and
acts on nothing — a simulator with a side effect is a deploy with extra steps. What a candidate
would **newly contain** is called out on its own, because more containment is the direction that
costs somebody their checkout.

**Three that look alike** — `/console/compare`. An attack, an outage and a dunning storm side by
side in the same layout, with the same thresholds judging all three, reaching three different
decisions. Each column shows the entity, the shop around it, every explanation weighed with its
probability, what the winner expected and did not get, and the cost of being wrong in both
directions — which are never equal. Computed from the committed corpus rather than stored
traffic, so it works on a clean clone and cannot be improved by seeding a friendlier database.

**`METRICS.md`** — generated by `pnpm metrics`, not hand-written. Every entity of every kind in
all eight scenario families, arbitrated, with the decisions and the abstention rate. Currently
**zero false positives across 942 non-attack entities**, two of three attack families contained,
one recognised and escalated to a person, none unrecognised.

**Incident queue and detail** — `/console/incidents`. The queue carries severity, status, age,
time-to-detect, expiry and a suggested action *labelled as a suggestion*, because nothing in this
console acts yet. The detail view shows the score as the sum it actually is, every term signed,
with mitigating evidence in the same list rather than a panel away — a reader deciding whether to
act on somebody needs to see what argued against it in the same glance.

**Model benchmark** — `ml/models/transaction_risk`, a Python pipeline whose deliverable is an
*honest evaluation*, not a leaderboard score. It reconstructs the card identity the IEEE-CIS
community found (`card1 + addr1 + first-transaction-day`, recovered via `D1`), splits on **whole
cards ordered by time with a delay gap**, trains a calibrated gradient-boosted model over a logistic
baseline, and reports precision, recall, PR-AUC and calibration with **bootstrap confidence
intervals** on a test set it never saw.

The committed numbers are from the **real IEEE-CIS data**. The headline is the **leakage delta**: the
same model scored on a careless random split next to the honest one. The careless split shares
**42,628 cards** across train and test and scores PR-AUC **0.53**; the honest split shares **zero**
and scores **0.36** — a **+0.16** inflation that is purely the model memorising cards it will not see
again. The boosted model is ~5× the logistic baseline (0.36 vs 0.07), well-calibrated (Brier 0.034),
and at its cost-optimal operating point declines only **0.85%** of legitimate shoppers. That leakage
gap is the difference between a score and a claim, and it is the number the whole slice exists to
publish.

`make eval` is deterministic from a fixed seed (two runs byte-identical). The competition **data** is
**never committed** — the rules forbid redistributing it (§7.B) and it is gitignored — but a **model
trained on it and its metrics are publishable** under the repo's MIT licence (§8.B), so a reader sees
the real held-out numbers without the data. `make check-metrics` verifies them against the real data
when it is present, and falls back to a synthetic determinism check when it is not (a clean clone, or
CI), so the gate never fails for want of data it may not hold. Absent the data the pipeline runs a
deterministic synthetic stand-in (fraud clustered by card over time) and writes it to a side file
rather than overwriting the real result. Every artefact records which source produced it.

**Metrics page** — `/console/metrics` renders the artefact: the leakage delta first, the held-out
numbers with their intervals, feature importance (card identifiers correctly near zero on the honest
split), the cost-chosen threshold, and an error taxonomy — each under the synthetic-vs-real label.

It also carries the two things that turn a score into an operating decision. The **operating point**
is shown as three actions, not one number: at the cost-optimal block threshold, the page reports the
share blocked, the riskiest non-blocked slice routed to a human — capped at a declared analyst budget,
because review is a capacity and not a free tier — and the **false-decline rate**, the legitimate
shoppers wrongly blocked as a share of all legitimate traffic, which is the number a merchant feels and
a precision figure hides when fraud is rare. And a **reliability diagram** plots predicted probability
against the fraction actually fraud, so "the probabilities mean what they say" — the thing a cost-based
threshold quietly rests on — is visible rather than asserted through the Brier score alone.

**Incident classifier (Model B)** — `ml/models/incident`, a second Python pipeline, and the first
model that runs *in the request path*. It classifies an incident into one of four decidable causes —
attack, outage, retry storm, healthy traffic — with an explicit **abstain** (a reject option, not a
fifth label): below a confidence bar the model declines rather than guessing. Its training data is
exported from the scenario corpus through `@sentinel/detect`'s `incidentFeatures` — the **same**
function the API scores with — so the ten features a model trained on are byte-for-byte the ten it is
served, and the feature definition is versioned (`fdv-…`) and pinned in a registry alongside the
training-data hash. The split is grouped on scenario so no scenario is on both sides (zero overlap).

The corpus turned out cleanly separable — macro-F1 1.0 — so **corpus hardening** fired automatically:
feature noise added and the model re-scored to a harder, honest 0.976, which is the number quoted. The
**ablation ladder** shows why the population-level view earns its keep — drop the traffic-context
features and outage-versus-attack collapses to 0.79, because a per-entity view genuinely cannot tell
them apart. `make eval` is deterministic (byte-identical runs), gated the same way as Model A.

**Served, not shelled out to** — the model exports as a linear `model.json` (a scaler and a weight
matrix folded through temperature scaling). `ModelScoringService` evaluates it in TypeScript as a few
dot products and a softmax: no `onnxruntime-node` native dependency, exact per-feature contributions
(SHAP is closed-form for a linear model) for the "why the model leans this way" panel, and a designed
**degraded path** — when the artefact is absent the API reports unavailable, the console shows
`degraded:model`, and the system runs on rules and arbitration alone. The model is advisory: arbitration
still decides what is *done*; scoring is trigger-only and capped at 100 incidents a pass. The incident
detail carries the opinion (predicted cause, calibrated distribution, top contributions) and the metrics
page publishes the four-class confusion matrix, the ablation ladder and the risk–coverage curve. The
served artefacts ship into the API image and are guarded as runtime files, so a container without them
fails the build rather than silently degrading in production.

**Narration (`packages/narrate`)** — the plain-English account of an incident, built so a model can
never state a fact it was not given. The package is a frozen **catalog of atomic claims**: each has a
stable id, a `bind` that resolves its typed slots from the incident's verified evidence, and a `render`
that fixes the wording. The split is the safety property — a model chooses *which* claims by id and in
what order; `bind` supplies every number from the evidence; `render` owns every word. There is no path
by which a narrative contains a sentence that is not one of these renderers run over values that came
from the evidence, so the class of failure where an LLM invents a figure is designed out rather than
guarded against after the fact.

A **fact guard** sits between selection and rendering: a claim id that is unknown to the catalog is a
hallucination and is dropped; a known claim that does not apply to these facts is unresolvable and is
dropped; the number dropped is returned as a **hallucination SLI**, so a narrator going wrong is
countable rather than invisible. The source **degrades live → local → replay → template**, each tier
choosing only the ordering, with a per-line badge. Because the words are bound and not generated, every
tier renders the *same* sentences — so pulling the provider changes the badge and nothing else, and
`replay` reproduces a recorded live run byte-for-byte. A **circuit breaker** (deterministic, clock
injected), a hard timeout and bounded, queue-capped concurrency front the provider so a slow narrator
sheds load to the on-device tier instead of stalling every incident behind it.

**Narrative panel** — the incident detail leads with the account, every line tagged with where its
words came from, and a footer that names the evidence hash, any fact-guard drops, and whether the tier
degraded below the one that was asked for. The default build ships no provider, so it runs on-device;
the live tier is a provider adapter that slots in when one is configured.

**Backpressure and graceful degradation (`packages/load`)** — Google SRE's criticality taxonomy as
running code. Every unit of work is mapped to a tier: `CRITICAL_PLUS` ingestion (never shed — if we
cannot persist, return non-2xx so Razorpay retries), `CRITICAL` decision (degrades to rules-only, never
dropped), `SHEDDABLE_PLUS` model and enrichment (shed under real pressure, never substituting a default
for missing state), and `SHEDDABLE` narration (dropped freely, template stands in). The `Shedder` decides
**on the p99 tail against the SLO, not average utilisation** — because a service can sit at a healthy mean
long after its tail has breached — sheds at the producer, and caps the queue at half the worker pool
(SRE's ≤50% guidance). A `LatencyWindow` keeps fixed-memory percentiles (p50/p95/p99/p99.9/max), a
`CircuitBreaker` (deterministic, clock injected) and absolute deadlines round it out.

The API's `LoadService` owns the bounded warm-path pool and the shed/run tallies; narration and model
scoring consult the same controller, so what the console shows being shed is exactly what is being shed.
`GET /api/system/health` serves the live snapshot; two env-gated probe endpoints let a load generator
drive the system without auth.

**Measured, not asserted** — `scripts/loadtest.mjs` is an open-model (constant-arrival-rate) load harness
that times each request from its intended send instant, so coordinated omission cannot understate the
tail. The published run (docs/performance-report.md) shows the two-phase demonstration: below the knee the
tail is flat and nothing sheds; past the knee the warm-path p99 collapses (~1,580x) while **ingestion
holds at 2 ms** and ~15,600 enrichment and narration units shed — `dropped_iterations = 0`. The
three-way latency split confirms the feature fetch dominates, not the model (inference p99 ~1 ms). Peak
training RSS (Model A 255 MB, Model B 164 MB) is captured, and the parquet-pruning and
distributed-was-slower stories are recorded as [ADR-0002](docs/adr/2026-08-26-0002-single-machine-compute.md)
and [ADR-0003](docs/adr/2026-08-26-0003-latency-tail-and-shedding.md) — documented, not faked. Every number
is labelled synthetic.

**System-health page** — the console's health view leads with a live load section: which tiers are
shedding right now, the three-way latency split, and the worker-pool/queue signals, refreshed every two
seconds so shedding is visible as it happens. The existing ingestion-health view sits below it.

**Scenario matrix** — `scripts/scenario-run.mjs` runs all eight synthetic scenario families through the
full detection pipeline; the deterministic result (docs/performance/scenario-matrix.md) is **8/8 correct**
— all three attacks caught and contained (loud → session, low-amplitude → session, distributed →
network), all five benign or operational families left alone. The distributed attack is the interesting
one: enumeration spread across a proxy pool at ~2 attempts a session trips no single-entity rule, but the
pool shares one **/24 subnet** and the network correlation groups by /24 exactly so a session-rotating
attack is still caught by the address block it comes from — which is why the detector evaluates a session,
a device *and* a network on every pass. An integration test
(`incidents.integration.test.ts`) pins that behaviour. (An earlier version of the harness keyed the
network on the full IP rather than the /24 and so mis-reported this as a coverage gap; mirroring
production's subnet grouping corrected both the harness and the report.)


**Audit chain** — `packages/audit`, and a `sentinel.audit_log` table. Every decision and every
hand that touched one is appended as an entry carrying the hash of the entry before it, so
changing any past row changes its hash, which breaks the link the next row recorded. `verifyChain`
walks the whole thing and reports the **first place it stops adding up** — a mutated field, a
deleted row, or a reordered pair, each with a reason a person can act on.

The sequence number is a `bigserial` (a deleted row leaves a visible gap) and `prev_hash` is
unique (two concurrent appends cannot fork the chain — the loser retries against the new head).
Appends are mirrored from the single choke points the working records already pass through —
containment events and incident transitions — so no path changes state without leaving a link.

**What it does not claim.** A hash chain alone does not stop a determined attacker with write
access from rewriting the entire tail consistently; for that the head hash must be anchored
outside this database. That anchoring is stated as out of scope rather than implied, and the head
hash the verifier returns is exactly what such an anchor would pin.

**Audit page and per-incident trail** — `/console/audit` lists the chain and carries the **Verify
chain** button, and the incident detail page shows that incident's own trail. The same walk runs
from the command line as `pnpm audit:verify`, which exits non-zero on a broken chain.

**System health page** — ingestion rate, duplicate rate, queue depth, oldest waiting event,
dead-letter depth, late-event count, and the watermark. It states whether ingestion is
configured *before* showing any number, because an unconfigured webhook and a healthy idle
one produce identical zeroes.

**Design system** — light theme only, by decision. Tokens plus five primitives: Button,
Badge, Card, Callout, Table. Semantic colour is kept separate from the accent so "needs
attention" never reads as "branded".

**Gates** — lint, typecheck, unit tests, format check, data-size guard, gitleaks, a payload-leak
guard, a Docker manifest check, a metrics-freshness check, and end-to-end. **565 unit tests** (api 277, detect 118, web 96,
policy 31, corpus 20, contracts 13, storefront 10, ui 9), **157 integration tests** and **38
Playwright tests** — the last figure verified at slice 10 plus the containment-enforcement pair.

Slices 11 and 12 add: an `@sentinel/audit` unit suite and integration suite (the corrupt-and-catch
demo), a Python pytest suite for split integrity and eval reproducibility, `AuditPage`,
`MetricsPage`, and model-metrics web suites, and E2E cases. The Python `make eval` and its
determinism **have been run** (byte-identical across runs); the JS and pytest **suites are written
but not yet executed** — deferred until asked, and the counts will be updated once they run.

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
- Every benign and operational scenario family produces **zero incidents**, asserted per family
  in its own database — mixing them anchors the feature window to the longest and tests an
  accident of the corpus rather than the detector
- A replayed enumeration burst becomes **exactly one incident** end to end, through replay,
  ingestion, redaction, state resolution, features, rules and clustering
- Change detection's false-alarm rate and its detection floor are both asserted, so neither can
  be improved silently at the other's expense
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

**The leakage delta came out backwards, which meant the demonstration did not work.** The first
synthetic generator gave fraud such a strong feature signal that the model aced both splits, leaving
no room for memorisation to inflate the careless one — so the honest split scored *higher*, the
opposite of the point. Rebuilt so fraud is mostly a property of the card and the transaction-level
signal is deliberately weak: now the careless split memorises the card and inflates by +0.11, and
the honest split is left with only what generalises. This is the more faithful design anyway — most
of the signal in card fraud really is the card's history.

**LightGBM's native build crashed on this machine** with an access violation inside `fit` — an ABI
fault, not a code bug. Rather than fight it, the boosted model tries LightGBM and falls back to
sklearn's histogram gradient boosting (the same algorithm), records which backend ran on every
artefact, and computes feature importance backend-agnostically via permutation. LightGBM remains the
intended backend where its build is healthy; the fallback means a reviewer on a broken install still
gets a real run rather than a stack trace.


**`contain` contained nothing.** The method that answers "is this entity blocked" existed, was
tested, and was called by nobody — a contained session could still open an order. The checkout
now asks it before creating the order, so the action performs the refusal it describes. Blocking
is on any of the entity's three keys, so an attacker who rotates sessions is still stopped by a
block on the network.

**The kill switch claimed to work without a deploy, and does not.** `policy.yaml` is baked into
the image, so engaging the switch means editing the file and redeploying — no code change, but
not the instant runtime toggle the comment promised. Reworded to match the deployment: policy
changes go through the same reviewed, revertible path as code, which is the intended virtue and
was misdescribed as a limitation. If instant engagement is ever needed the file moves to a
mounted secret.


**The policy hash did not depend on the policy.** `JSON.stringify(policy, sortedKeys)` looks
right and is not: an array replacer is a key *filter*, and dotted paths match none of the actual
keys, so it hashed an almost-empty object. Every decision was recording a fingerprint that would
not have changed if every threshold in the file had. Caught by the test that asserted a changed
value changes the hash.

**A share cap made containment impossible in a small shop.** "At most 5% of active sessions"
reads as a sensible ceiling and means that a shop with three customers can never contain anyone,
because one of three is a third of everything. The same mistake as reading a shape into six
attempts: a proportion over a tiny sample carries no information while looking like an
emergency. The share now applies only above a declared number of sessions; the absolute caps
still hold below it.

**Replayed incidents could never be acted on.** Staleness is measured against the wall clock,
which is right — a pipeline an hour behind must not be blocking anybody — and makes every
replayed scenario months stale, so the degradation matrix refused everything and the approval
flow could not be exercised or shown. A replayed incident is now judged standing at the moment of
its own data, and the decision carries a code saying so: a containment against a replayed session
blocks nobody, and pretending it was decided in the present would be the dishonest half.

**The Docker guard earned its place.** Adding `packages/policy` broke both images, and the check
written two slices ago caught it before a build did. It did not catch that `policy.yaml` itself
must reach the runtime — the API refuses to start without it, so the image would have built
cleanly and failed to boot. The guard now checks runtime files too.


**`METRICS.md` was generated and then never checked.** A committed artefact nobody regenerates is
a file that makes confident claims about a detector that has since changed. `pnpm check:metrics`
now regenerates it in memory and fails if it differs, in the gate and in CI — the same treatment
the formatter gets, for the same reason.

**Arbitration was stored and never asserted on.** Every arbitration test pointed at `/compare`,
which computes from the corpus and never touches the database, so the column the detection pass
writes was entirely uncovered. It turned out to be correct; the point is that it was the same
gap that let the change detector stay wired to nothing for a slice.

**Counting payments made the hot path quadratic.** Collapsing webhooks to payments runs inside
the pure functions so it cannot be forgotten, but a pass calls `computeFeatures` once per entity
with the same array — thousands of dedupes of twenty thousand rows. Memoised on the input array,
and the discovery step now groups once instead of filtering per entity. A pass over 20,000 events
and 20,000 entities went from quadratic to **1.5 seconds**.

**The console overstated what it had considered.** `candidates` counted every entity key across
the whole read, which is bounded by row count rather than by time, while the vectors beside it
were window-filtered — so a page saying "N entities seen" could claim thousands when the window
held two. It now counts the entities actually judged.


**Webhooks were being counted as payment attempts.** A successful payment emits three of them —
authorized, captured, order paid — and a failed one emits a single event. Every rate in the
detector therefore had a denominator inflated by however many events a *success* happened to
produce: `normal_traffic` showed 132 attempts for 48 actual payments. The effect was to crush
healthy traffic's approval rate while leaving an attack's untouched, so the detector separated
them noticeably better than it deserved to. Attempts are now payments, resolved to one outcome
by the same ranking the payment state machine uses, inside the pure functions rather than left
to callers.

**An outage was being concluded without the gateway ever being blamed.** `attack_distributed`
rotates session, device and network, so failure is spread across many unrelated-looking entities
— which is also what an outage looks like. The outage hypothesis scored that spread and concluded
an outage on traffic where Razorpay had blamed nobody. Gateway attribution is now definitional
rather than merely indicative: without it the outage case scores zero, and the distributed attack
is explained correctly as an attack on every entity.

**Counting shoppers while most of them fail was reading as health.** The healthy-traffic
hypothesis counted "many different shoppers" independently of whether their payments were
succeeding, which is precisely the shape of a distributed attack — and it was carrying that
hypothesis to a win over one. Also renamed from `flash_sale`, because it wins on ordinary traffic
too and calling that a flash sale on the page an analyst reads would be wrong.

**A single failed payment scored as an attack.** The attack and retry hypotheses are about
proportions — cards per attempt, attempts per card — and a proportion over one attempt carries no
information while looking like a strong signal. Both now require enough attempts for the shape to
mean anything.

**Card spread fired on a busy shop.** At network level a flash sale had 176 distinct cards across
176 attempts and 89% approved, which satisfied "a new card nearly every attempt" exactly. The
rule now also requires the approvals to have collapsed — a card list being walked does not get
approved, which is the entire point of walking it. Arbitration additionally gates whether an
incident opens at all, so an explanation of ordinary traffic suppresses it regardless.


**Tier 2 was wired to nothing.** Change detection was fed a two-element series — an incident's
first and last attempt — while the comment claimed it was reading the entity's arrivals. Nineteen
tests stood behind EWMA and CUSUM and not one assertion checked the result in the API, so it
passed. It now runs over real arrival times, and **across the shop rather than per entity**, which
is the level the method is good for: a session has no history by construction, so asking whether
it changed can only answer "it is new".

**Incidents were labelled by the query, not by the data.** An incident built entirely from
replayed events, evaluated with the default scope of both, was stored as `razorpay` — synthetic
traffic presented as a real detection, which is the one thing this project claims it never does.
Provenance now comes from the events behind each correlation key, and `replay` wins a tie.

**An empty detection pass expired the whole queue.** A pass over a source with no events fell back
to the wall clock, and every incident recorded against historical timestamps is idle by that
reckoning — so one empty pass closed every incident, irreversibly, since `expired` is terminal.
Found by the end-to-end suite, which cleared replayed events between tests and then could not move
an incident it had just opened. A pass that sees nothing now expires nothing, and expiry is scoped
to the traffic the pass actually looked at.


**Change detection tuned on tidy noise was tuned on the wrong distribution.** The textbook CUSUM
pairing false-alarmed on a third of quiet entities, which was obvious once measured. Less obvious:
after a sweep brought the synthetic false-alarm rate to 0.55%, the same settings still alarmed on
the corpus's own `normal_traffic`. Real traffic arrives in clumps that a well-behaved series does
not. Re-tuned against the corpus itself: **zero false alarms across all five benign families and
500 stationary series**, catching a sustained 1.5× shift every time.

**What that cost, recorded rather than hidden.** A setting sensitive enough to catch
`attack_distributed` — which rotates session, device *and* network, 37/37/29 of them, so no single
entity looks remarkable and Tier 1 scores every one at 0.35 — also alarms on ordinary traffic.
Measured, the choice was between catching that attack and never crying wolf, and a false positive
on legitimate traffic is the expensive mistake here. So it goes uncaught, and a test pins that
fact so it cannot be reversed by accident. It is the blindness the architecture plan describes for
cross-merchant distribution, arriving one level earlier than expected.

**The dunning storm opened an incident.** Twice, for two different reasons, and both were the
expensive mistake — telling a merchant that collecting its own money is an incident.

First, `card_reuse` was expressed as cards-per-attempt below 0.3, which is silent on four cards
across eight attempts. That is what a biller looks like through a thirty-minute window when only
part of its schedule is in view. Reformulated as attempts *per card*, which is the thing actually
being claimed.

Second, and more structural: at network level the run showed eight cards over fourteen attempts —
too little reuse to mitigate, too little spread to accuse — and `approval_collapse` plus
`reason_mix` alone carried it over the floor. But those two say *a lot of attempts failed the same
way*, which is equally true of enumeration and of a biller working through cards that are out of
money. Opening an incident now requires at least one rule that describes **how the traffic
behaves** rather than **that it failed**.

**Every replayed incident was born expired.** Expiry compared `expires_at` against `now()` while
the corpus carries timestamps from months ago, so an incident opened and closed in the same pass —
and `expired` is terminal, so the analyst got a queue of things they could not touch. It now
expires against the moment the pass judged as of, which is the same thing for live traffic.

**One burst produced three incidents.** A machine has one session, one device and one network, and
evaluating all three kinds found the same attempts three times. Three rows for one thing is the
same failure as sixty alerts for one burst, only smaller. Identical span and identical attempt
count now collapses to the narrowest key — containing one session is a smaller act than containing
a network for the same evidence — while a genuinely broader incident survives, which is the case
that must not break when an attacker rotates sessions.


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

Slice 16: submission — the README, the demo path, the one-command clean-clone run, and the final
`v1.0.0` tag. The build is otherwise feature-complete against the plan.

Just built — Slice 15: performance and graceful degradation. Google SRE's criticality taxonomy made
concrete — CRITICAL_PLUS ingestion that is never shed, down to SHEDDABLE narration that drops freely —
with a load controller that sheds **proactively on the p99 tail against the SLO**, at the producer, with
the queue capped at half the worker pool. An open-model (constant-arrival-rate) load harness measures the
tail honestly (each request timed from its intended send instant, so coordinated omission cannot hide the
latency), and the measured result is the demonstration the architecture exists to produce: past the knee
the warm-path p99 collapses ~1,580x while **ingestion latency stays flat at 2 ms** and tens of thousands
of enrichment units shed. The three-way latency split shows the feature fetch dominating, not the model.
The console's system-health page shows the shedding live. Training peak RSS (255 MB / 164 MB) and the
distributed-was-slower decision are recorded as ADRs, and all eight scenario families were run through the
detector (8/8 correct) — see docs/performance-report.md, docs/performance/scenario-matrix.md, and the ADRs.
Everything is labelled synthetic.

Previously — Slice 14: narration. The incident told as a short, plain-English account — and the model
that writes it is allowed to emit only claim identifiers, never prose, not even a connective. A fixed
catalog of atomic claims each bind their values from the incident's verified evidence in code, so a
narrative physically cannot state a number the evidence did not carry; the model only chooses which
claims to make and in what order. A fact guard drops any claim id that is unknown or does not apply,
and counts the drops as a hallucination signal. The source degrades live -> local -> replay -> template
with a per-line badge, and because the words are bound rather than generated, pulling the provider
changes the badge and not a word of the account — replay reproduces a recorded live run byte-for-byte.
A circuit breaker, a hard timeout and bounded, queue-capped concurrency sit in front of the provider so
a slow narrator sheds to the local tier instead of stalling the request.

Just built — Slice 13: Model B, an incident classifier that runs in the request path. A four-class model
(attack, outage, retry storm, healthy traffic) with an explicit abstain, trained on the scenario corpus
through the *same* `incidentFeatures` the API scores with — one feature definition, versioned, so the
number a model trained on is the number it is served. It ships as a linear `model.json` the API evaluates
directly: no native ONNX runtime, exact per-feature contributions for the "why" panel, and a designed
degraded path — when the artefact is absent the system runs on rules and arbitration alone and says so
(`degraded:model`) rather than leaving a silent gap. The model is advisory throughout: arbitration still
decides what is done; the model only offers a second opinion, capped at 100 scored incidents a pass and
only on incidents already warranted. The corpus proved cleanly separable (macro-F1 1.0), so corpus
hardening fired — noise added, re-scored to a harder, honest 0.976 — and the metrics page publishes the
ablation ladder (traffic-context features are what separate outage from attack), the four-class confusion
matrix and the risk–coverage curve rather than a single flattering accuracy.

Previously: Slice 11 — the audit chain. Every decision and every hand that touched one, in a tamper-evident
sequence: containment already records who did what and when, and this makes that record
impossible to edit after the fact rather than merely inconvenient.

Previously: Slice 10 — policy, approval and containment. The first slice that can actually *do* something:
versioned policy as code, the five reversible actions with mandatory expiry, and dual approval
above an impact threshold. Everything so far decides and explains; nothing yet acts.

Previously: Slice 9 — arbitration and suppression. Attack, outage and retry storm as **competing hypotheses**
rather than one score with subtractions: the system should say which explanation fits best and
why it rejected the others, and suppress the incident outright when the better explanation is
somebody else's outage.

Previously: Slice 8 — rules to incidents. Deterministic rules and change detection over the
feature vectors, grouped into one incident per episode with the evidence that opened it and the
evidence against it attached. Mitigating evidence is a first-class outcome, rules emit codes
rather than prose, and a rule that cannot run abstains rather than reading as innocence.

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
