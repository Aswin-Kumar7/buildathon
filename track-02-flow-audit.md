# Sentinel Track 02 — End-to-End Flow and Architecture Audit

**Date:** 2026-08-27  
**Scope:** storefront, order creation, Razorpay integration, webhook ingestion, canonical state,
features, detection, model scoring, arbitration, incidents, policy, simulation, audit and console UI.

## Executive conclusion

The backend has a credible defensive detector architecture, but the product flow was not fully
connected from a merchant's point of view. The most important break was Simulation: it wrote synthetic
events to the inbox and returned before the rows were drained and detected. The page then directed the
merchant to Attempts, while the result they needed was in Incidents. A second issue was that incident
list rows showed score/rule fragments without the decision context, making attack, outage and retry
storm cases look too similar.

Those structural breaks are now fixed:

- replay drains every pending batch for the replay source before returning;
- replay immediately runs replay-scoped detection and returns `evaluated`, `opened`, `updated` and
  `expired` counts;
- the Simulation page reports those detection results and directs the merchant to Incidents;
- incident summaries now include primary hypothesis, recommended decision, attempt count and failure
  count;
- incident detail resolves related canonical orders and attempts through the incident's entity
  pseudonym and activity time range;
- incident detail leads with an explicit Detection → Recommendation → Action → Status summary;
- policy simulation has a guided structured builder while retaining the full-document advanced path;
- incident detail links to a filtered Attempts route by entity and source;
- a separate worker entrypoint is available for Azure, with the API timer disableable via
  `INBOX_WORKER_ENABLED`;
- the Incidents table presents risk type, activity, decision and status as separate merchant-facing
  fields;
- repeated evaluation of a partial or differently correlated burst is prevented from creating a
  second incident;
- replay cleanup removes replay incidents as well as replay events and checkout context.

The flow is now structurally coherent for local demo traffic. It is not yet a production-grade
Razorpay risk platform: live webhook delivery still requires public HTTPS and a correctly configured
Azure deployment, and hosted Razorpay checkout cannot be completely automated by the local test
suite. Real merchant-labelled data also remains an external input.

## What is actually connected

```text
Public storefront
  └─ GET /api/catalog
  └─ POST /api/orders
       ├─ server-side cart pricing
       ├─ session/device/network pseudonyms
       ├─ advisory pre-check risk assessment
       ├─ containment check
       ├─ Razorpay POST /v1/orders
       └─ checkout_sessions row keyed by razorpay_order_id

Razorpay hosted Checkout
  └─ browser receives only paid / failed / dismissed result

Razorpay webhook
  └─ POST /api/webhooks/razorpay
       ├─ raw-body HMAC verification
       ├─ encrypted transactional inbox
       ├─ durable 2xx acknowledgement
       └─ drain to redacted canonical_events

Detection
  └─ point-in-time features
       ├─ deterministic rules
       ├─ EWMA/CUSUM change detection
       ├─ arbitration: attack / outage / retry / healthy / insufficient evidence
       ├─ deployed binary P(abuse) model where warranted
       └─ one incident per activity episode

Merchant console
  └─ Overview: aggregate live risk picture
  └─ Incidents: queue, explanation, recommended decision and status
  └─ Incident detail: evidence, model opinion, policy action, history and audit
  └─ Metrics: held-out model quality and operating point
  └─ Policy: current policy plus candidate simulation
  └─ Simulation: labelled replay → immediate detection → incident review
```

## Findings by screen

### Overview

The redesigned Overview reads `/api/overview?window=24h` and refreshes periodically. It is now a
reasonable merchant landing page: event volume, blocked/contained activity, review activity, safe
outcomes, risk trend, recent events, top reasons and the protection lifecycle are grouped into a
single view.

Important interpretation limits remain visible in the implementation:

- “safe” means no failure signal in the canonical event set; it is not proof of no fraud;
- “blocked” currently reflects active containment/incident protection, not a confirmed count of
  Razorpay authorizations refused at the gateway;
- live and replay traffic must remain separate or the dashboard would overstate real performance;
- webhook events are canonical payment events, while checkout context is a separate merchant sensor.

### Incidents

Before the structural fix, a row mainly exposed severity, score, rule chips and status. That forces a
merchant to open every row to answer basic questions. It now exposes:

| Merchant question | Field shown |
|---|---|
| What kind of risk is this? | `primaryHypothesis` — likely abuse, outage, retry storm, healthy traffic or insufficient evidence |
| How large is the activity? | `attempts` and `failures` from the stored feature snapshot |
| What should I do? | `recommendedDecision` — contain eligible, review required, monitor or no action |
| What is the current lifecycle? | `status` — open, under review, contained, resolved or expired |
| What triggered it? | first fired rule signal plus full evidence on detail |
| Is it real or synthetic? | live/replayed source indicator |

This is the correct split between **detector conclusion** and **merchant action**. A recommended
decision is not the same as an action already taken. The action remains explicit and auditable in the
incident detail and containment workflow.

### Incident detail and action tracking

The detail page now presents the merchant's first decision surface as Detection → Recommendation →
Action → Status, followed by the evidence and audit trail. It contains the strongest decision evidence
in the codebase:

1. signed evidence terms and weights;
2. abstentions and missing evidence;
3. change detection across the shop;
4. model opinion and whether it was available;
5. arbitration winner, runner-up and margin;
6. policy-derived containment decision;
7. approval, activation, expiry, release and incident-transition history;
8. append-only audit entries.

The action language is intentionally conservative: the model cannot directly block a shopper. It can
support review or move a case toward containment, while policy, degradation rules, impact caps and
human approval decide whether a customer-impacting action is permitted.

### Risk and Model

The model page is data-rich rather than merchant-simple. Its correct purpose is model governance:
held-out PR-AUC, precision, recall, F1, calibration, per-origin behavior, leakage comparison and
operating-point costs. It should not be the first place a merchant decides what to do with one
transaction.

Recommended information hierarchy for the next UI pass:

1. **Can I trust the model today?** availability, model version, held-out recall/precision and
   synthetic-data disclaimer;
2. **What does it do in production?** observe/review/contain-eligible shares and false-decline rate;
3. **Where does it fail?** per-family false positives and missed attacks;
4. **How does it explain one case?** link to an incident detail, not another dashboard block;
5. **How was it trained?** corpus, grouped split, leakage delta and retraining labels.

### Policy

The current policy page is safe and now provides a structured candidate builder for the high-impact
merchant controls: step-up/contain thresholds, containment duration, dual-approval amount, active
containment cap and kill switch. It generates a complete candidate document and runs the same
validated dry-run simulator. An advanced editor remains for the less frequently changed fields.
It is still not a complete merchant policy-management workflow: there is no persisted draft/version
lifecycle, approval workflow, diff or publish action from the UI.

That is a deliberate security boundary in the current architecture, not a missing HTTP call: a policy
is versioned code, and every decision stores the version/hash. A production merchant workflow should
add:

- a form grouped into Detection, Customer impact, Approvals, Expiry, Caps, Degradation and Allowlist;
- validation before preview;
- a diff against the current policy;
- a dry-run impact report on recorded incidents;
- review/approve/publish states;
- immutable policy version and hash in every decision;
- rollback to a prior approved version;
- no direct production activation by a single analyst.

Until that exists, the honest UI copy remains “preview impact” / “simulate a candidate policy” rather
than “add policy”.

### Simulation

Simulation now performs a full local path:

1. load a committed labelled scenario;
2. write pseudonymised checkout context;
3. write encrypted inbox events with `source = replay`;
4. drain all replay batches;
5. derive canonical events;
6. run replay-scoped feature computation and detection;
7. create/update incidents;
8. return detection counts to the page;
9. direct the merchant to Incidents for review and action.

The replay source is kept out of live merchant statistics. The attack scenarios are still synthetic,
so they demonstrate detector behavior and reasoning, not real-world model performance.

### Attempts

Attempts are correctly reconstructed from canonical event history and checkout context, but they are
a different unit from incidents. An incident is a correlated episode across session/device/network;
an attempt is one payment attempt. Incident detail now has a related-attempt section backed by an API
query joining incident entity pseudonyms to checkout sessions and canonical payment attempts. It does
not fake payment count from `observations`; when no canonical attempt exists it says that the case may
be pre-payment or awaiting a webhook.

## AI and ML assessment

### Where ML is used

The deployed model is a binary risk model that produces `P(abuse)` for warranted entities. It is
trained against the scenario corpus with a held-out evaluation and its feature definition is shared
with the request-time scoring path. Model opinion includes risk, band, predicted class, abstention and
feature contributions.

It is used in the incident evaluation path, capped and shed under load. The model can corroborate,
escalate or de-escalate a rule/arbitration result, and can raise a review incident for a live entity
that rules missed. It cannot autonomously contain a shopper.

### Where ML is deliberately not used

- Razorpay order creation uses deterministic validation, server-side pricing and containment checks;
  a heavy model would add latency and does not have post-payment evidence yet.
- Webhook authenticity uses HMAC, not AI. Cryptographic verification is the right tool.
- Canonical payment state uses a deterministic status ordering, not prediction.
- Policy legality, expiry, approval count and impact caps are explicit code because a merchant needs
  enforceable guarantees.
- Arbitration is a transparent competing-hypotheses layer because raw binary risk cannot distinguish
  an attack from a gateway outage or a legitimate retry storm on its own.
- Narration is claim-id based and evidence-bound; an LLM is not allowed to invent incident numbers.

### Is the model claim correct?

The implementation is technically honest about model governance: it exposes held-out metrics,
calibration, leakage comparison, false-decline rate and synthetic-data labeling. However, the corpus
is generated data, not a representative production chargeback/card-testing population. Therefore the
metrics support “the model separates these registered scenario families” and do not yet support a
claim of real-world fraud precision or recall.

Track 02 requires measured precision and recall on a held-out test set. The repository satisfies the
mechanical held-out requirement, but the submission should clearly state the test set is synthetic and
should add merchant-confirmed labels or a defensible public benchmark before making a production
performance claim.

## Track 02 scorecard

| Criterion | Current state | Assessment |
|---|---|---|
| Defense-only | Rules, arbitration, human-approved reversible containment | Strong |
| One class of loss | Card-testing / payment abuse detector | Correct scope |
| Detection reasoning | Evidence codes, signed weights, abstentions, arbitration and model contribution | Strong |
| Measured precision/recall | Held-out synthetic corpus with calibration and cost metrics | Honest but not production evidence |
| False-positive cost | Policy includes blocked-shopper/review/chargeback cost and model page exposes false-decline rate | Present |
| Real storefront signal | Session/device/network context captured at order creation | Present |
| Real Razorpay outcome | Depends on live test credentials and webhook delivery | External verification pending |
| End-to-end simulation | Now replay → drain → detect → incident | Fixed and verified |
| Merchant action | Review, propose, approve, contain, release/expire, audit | Present; UX can be clearer |
| Policy management | Read current YAML and simulate candidate | Not yet a complete merchant authoring workflow |
| Build quality | Typechecks, lint, unit/integration suites and local builds pass in targeted runs | Good, with hosted checkout limitation |

## Current architectural risks

1. **Live webhook availability:** no public HTTPS endpoint means Razorpay cannot deliver live events.
2. **Webhook secret deployment:** local `.env` is configured, but every deployment must configure the
   exact Razorpay webhook secret in its platform environment.
3. **Worker topology:** a separate worker entrypoint now exists. Azure can run the HTTP API with
   `INBOX_WORKER_ENABLED=false` and the drain process separately.
4. **Feature persistence:** the bounded graph uses checkout-session rows and Postgres queries. A
   persisted graph projection or streaming feature store is future scale work, not required for the
   free local build.
5. **Incident-to-attempt query:** implemented for incident detail and a direct filtered Attempts
   route; richer relationship visualization remains future work.
6. **Policy authoring:** durable draft → pending approval → approved → published workflow now exists;
   publish is admin-only, self-approval is refused, and each transition is audit-linked.
7. **Data labels:** analyst verdicts feed retraining, but there is not yet enough real merchant outcome
   data to validate production recall.
8. **TLS local environment:** this Windows environment needs `NODE_USE_SYSTEM_CA=1` for Node to trust
   its corporate/proxy certificate when calling Razorpay. This is not an application TLS bypass.

## Verification performed

- `@sentinel/storefront` unit tests: 10 passed.
- `@sentinel/web` unit tests: 125 passed after the incident and policy UI updates.
- Replay integration suite: 13 passed.
- Incidents integration suite: 33 passed, including exactly-one-incident deduplication.
- API typecheck and lint: passed.
- Console typecheck and lint: passed.
- Local Razorpay order creation: HTTP 201 with a real test order after enabling the system CA.
- Local API, console and storefront HTTP endpoints: reachable.

## Recommended next implementation order

1. Add richer session/device/network relationship visualization.
2. Add policy diff/rollback and connect the lifecycle to the merchant console.
3. Make live webhook delivery observable with the Azure HTTPS deployment and a webhook delivery test.
4. Add a merchant label workflow and export confirmed outcomes for retraining.
5. Add a real-data or carefully justified benchmark, preserving the synthetic corpus as regression data.
6. Add merchant-labeled data and a defensible non-synthetic benchmark before making production recall claims.
