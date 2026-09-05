# Compliance and threat model

Sentinel reads payment outcomes a merchant already receives, works out whether a burst of failures is
an attack, and proposes an action for a person to approve.

This document follows that path: what the system handles, one webhook from arrival to deletion, what
is allowed to act on it, how the AI is governed, and what we defend against. Every control named is a
file you can open, and §6 gives the command that checks each one.

---

## 1 · What Sentinel handles

|  |  |
| :-- | :-- |
| **Receives** | Razorpay webhooks the merchant already gets, plus an optional first-party storefront sensor supplying session, device and network |
| **Stores** | Payment outcomes, derived features, incidents, and the decisions taken on them |
| **Does** | Raises an incident, proposes a containment, records who approved it |
| **Card data** | Only `card_network`, `card_issuer` and Razorpay's own `card_id` token. No primary account number, no CVV, no track data |

One boundary is worth stating explicitly: Sentinel observes and advises, the payment processor
settles. Authorisation, capture, refunds and reversals stay where the money is. What Sentinel
contributes is a classification of why payments failed, and whether an outage or an attack explains
them better, which is evidence for whoever carries those obligations.

That boundary also keeps the system outside the cardholder data environment. There is no PAN in the
schema and nowhere to put one. Reducing the scope is the control.

---

## 2 · Following one webhook

The clearest way to see the data protections is to watch a single delivery from the moment it arrives
to the moment the customer data in it is gone.

### It arrives, and is checked before it is read

The HMAC is verified against the raw bytes, before anything parses them. Parsing first and
re-serialising to verify would change whitespace and key ordering, which works right up until a
payload happens to serialise differently.

### It is sealed before anything looks at it

The body carries a customer's email and contact number, so it is encrypted before it is parsed.
`apps/api/src/telemetry/envelope.ts` gives each event its own AES-256-GCM data key, wrapped under
`PAYLOAD_KEY_V1`.

The ordering is the point: if the process dies between receiving a delivery and processing it, what is
on disk is ciphertext, not a plaintext email in a queue table. Without the key the endpoint declines
the delivery instead of storing customer data in the clear.

### Identifiers become pseudonyms

`apps/api/src/telemetry/pseudonym.ts` uses a keyed HMAC-SHA256, and the key is the part that matters.
A bare SHA-256 of an email or an IP is not a pseudonym: the input space is small enough to enumerate,
so anyone holding the table recovers the original. An HMAC under a secret key makes that infeasible
while keeping the value stable enough to correlate on, which is what detection needs. Two attempts
came from the same place; where that place is stays unknown.

IPv4 is truncated to a `/24` and IPv6 to a `/48` before hashing, so the pseudonym refers to a
neighbourhood rather than a household. The `v1:` prefix exists because rotating a key would otherwise
break every longitudinal feature silently; on rotation both versions are written for one retention
period, then the old one is dropped.

There is no default key. `PSEUDONYM_KEY_V1` has no fallback and the API will not start without it,
because a key baked into the source would make every pseudonym on every installation reproducible by
anyone who read the repository.

### Only what detection needs is kept

The `Observation` type is the only shape a rule can read, and it is deliberately narrow. Its own
source says why: *"nothing here identifies a person, and a feature that wanted something that did
would have to justify it at this boundary rather than deep inside a calculation."* The email and
contact number that arrived in the body are never used as detection features.

### After seven days the customer data is destroyed

`purgeExpiredPayloads()` in `apps/api/src/webhooks/drain.service.ts` runs on the drain tick. Past
`FORENSIC_RETENTION_DAYS`, default 7, it nulls the ciphertext and every wrapped key and stamps
`purgedAt`.

The row survives, because deduplication needs the event id and everything downstream reads the
canonical event. Only the customer data goes, and the wrapped key goes with it, so nothing remains
that could decrypt anything.

### Nothing leaks on the way out

`pnpm check:payload` scans the built output for anything shaped like a card number, an email or a
contact number reaching a log, and fails the build. A CI gate rather than a review checklist, because
a checklist is only as reliable as the reviewer's attention on a Friday afternoon.

### And every step is on the record

Actions are written to a hash-linked chain: each entry commits to the one before it, so editing a past
entry breaks every link after it. `pnpm audit:verify` walks the chain and reports the first
divergence. Every containment records who approved it and the policy version in force.

---

## 3 · What is allowed to act

Detection produces a recommendation. Whether anything may be done about it is decided by
`policy.yaml`, which is parsed and validated at boot. The API will not start without the file, because
running on defaults nobody chose is worse than not running.

| Control | Shipped | What it guarantees |
| :-- | --: | :-- |
| `containmentAlwaysNeedsApproval` | `true` | Every block has a named person behind it |
| `dualApprovalAbovePaise` | 50,000 | High-value entities need two people |
| `containment.defaultMinutes` | 30 | Blocks are temporary by default |
| `containment.maxMinutes` | 120 | And bounded even when extended |
| `containment.maxExtensions` | 2 | Renewal cannot be used to work around the expiry |
| `impactCaps.maxActiveContainments` | 5 | Simultaneous impact stays small |
| `impactCaps.maxContainmentsPerHour` | 10 | A runaway loop stops itself |
| `impactCaps.maxShareOfActiveSessions` | 0.05 | Never more than 5% of live shoppers |
| `degradation.maxFeatureAgeMinutes` | 15 | Decisions rest on a current picture |
| `degradation.refuseWhenArbitrationAbstained` | `true` | Uncertainty stops an action instead of permitting it |
| `allowlist` | per-entity | Known-good sessions, devices and networks stay exempt |
| `killSwitch` | `false` | An operator stop that releases live blocks |

Containment expires on its own. A review queue assumes somebody comes back to it; an expiry assumes
nobody does. That assumption is what makes it reasonable to act on a signal that is half an hour old.

---

## 4 · Governing the AI

Four parts of the system are learned or generative, and each one has its own fence. The full detail is
in [ARCHITECTURE §5–6](ARCHITECTURE.md#5--the-ml-model).

| Component | What it may do | What stops it |
| :-- | :-- | :-- |
| Risk model | Score an entity, and raise a review | It can never contain anyone. A positively named benign cause overrules it entirely |
| AI Risk Manager | Draft a recommendation from a verified record | It may only name claim ids from a fixed catalog, and its proposed action is clamped to what policy already permits |
| Narration | Turn claim ids into sentences | An id outside the catalog is treated as a hallucination and dropped, and the number dropped is reported as a metric |
| Incident copilot | Answer an analyst's free-text question about one incident | Its context is scrubbed before it is sent, and it returns no answer at all when the model is unreachable |

The dropped-claim count comes back as a field on the result rather than a log line, because a
reasoning layer that keeps naming claims which do not exist is one going wrong, and that has to be
measurable.

The copilot is fenced differently, and the reason is worth understanding. Structured output can be
validated against a fixed catalog after the fact; a free-text answer cannot, so the control moves to
the input. `buildContext` writes only codes, counts, scores and the entity kind. The entity key, the
IP, the email and the card never reach the model, so it cannot disclose what the console withholds.
When the provider is unavailable it returns `available: false` with an empty answer, because a
fabricated answer to a merchant's question is worse than none. The prompt also forbids describing any
action as immediate or automatic, and the context says explicitly when an incident is simulated.

The shipped default for the risk manager is `RISK_MANAGER_MODE=local`: fully deterministic, no
language model, no network call. Both live tiers are opt-in and need a key.

---

## 5 · Threat model

### What Sentinel is defending against

Card testing. Somebody running stolen card numbers through a merchant's checkout to find the ones that
still work, in whichever shape they choose: loud, slow, distributed, or hidden inside an outage, a
flash sale or a dunning run.

### What it cannot be turned into

Track 02 disqualifies offence-capable work, and Sentinel meets that structurally rather than by
policy, so the property holds without anyone having to remember it.

There is no outbound HTTP client in `packages/corpus` or the replay path, so nothing can call out
because nothing capable of it exists. No real card number appears anywhere in the repository, fixtures
included. The simulator replays attack shapes rather than attacks, generating traffic inside the
process tagged `source: replay` end to end, which means it can never count as evidence about live
behaviour. No live credential is committed: gitleaks runs in CI and deployment authenticates through
GitHub OIDC.

### Attacks against Sentinel itself

| Vector | Control |
| :-- | :-- |
| Forged webhook | HMAC-SHA256 over the raw bytes, before parsing |
| Replayed webhook | Event id uniqueness. The row survives payload purge specifically to preserve it |
| Spoofed client IP | `TRUST_PROXY` defaults to `false` and accepts only `true`, `false`, `1` or `0`, so a permissive parse cannot quietly make `X-Forwarded-For` believable |
| Credential stuffing | `LOGIN_MAX_ATTEMPTS` and `LOGIN_WINDOW_MINUTES`. An unknown user and a wrong password return the same error |
| Poisoning the model through traffic | The model cannot act alone, and a positively named benign cause overrules it |
| Retrospective tampering | Hash-linked audit chain, independently verifiable |
| Database exfiltration | Payloads are ciphertext and identifiers are keyed pseudonyms. Both keys live outside the database |

### What we have not solved

A merchant whose dunning traffic looks unlike the corpus is the honest residual risk. The model flags
39 of 1,045 benign entities today, concentrated entirely in dunning and retry patterns, and
arbitration contains none of them. If real dunning has a different shape, that margin is where it
shows first.

The labels are also synthetic, so every accuracy claim describes behaviour against a specification
rather than the field. The path to retraining on a merchant's own confirmed incidents exists in the
schema and is unexercised. Both are in [PROOF §7](PROOF.md#7--what-is-still-wrong).

---

## 6 · Checking any of it

| Claim | Command |
| :-- | :-- |
| No PAN is stored | `grep -i "last4\|pan\|card_number" apps/api/src/db/apply-schema.ts` |
| Payloads are sealed on arrival | `apps/api/src/telemetry/envelope.ts` |
| Pseudonyms are keyed and truncated | `apps/api/src/telemetry/pseudonym.ts` |
| Retention is enforced | `purgeExpiredPayloads()` in `apps/api/src/webhooks/drain.service.ts` |
| Nothing leaks to logs | `pnpm check:payload` |
| The audit chain is intact | `pnpm audit:verify` |
| Nothing calls out to the internet | `grep -rn "fetch\|axios" packages/corpus/src` |
| The model cannot contain | `packages/detect/src/decision.ts` |
| Governance controls are enforced | `packages/policy/src/decide.ts` |
| All of it, at once | `pnpm check` |
