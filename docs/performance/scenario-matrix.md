# Scenario matrix

> **Synthetic, seed-deterministic scenarios.** Every family below is generated in-process from `@sentinel/corpus` at its committed seed and run through the pure detection pipeline (`features -> rules -> cluster -> traffic -> arbitrate`, mirroring `apps/api/src/incidents/incidents.service.ts`). No live traffic, no database, no clock, no randomness: `node scripts/scenario-run.mjs` produces byte-identical output every time.

Threshold fingerprint `54027eb9` (production thresholds, unmodified). Observation window 600 min / half-life 5 min — widened from the production 30-minute window so an entire episode is in view for every family, the same choice `comparison.service.ts` makes. The thresholds are the ones production uses; only the observation period is widened.

**Result: 11/11 families classified correctly** (attacks caught and warranted; benign and operational traffic not treated as an attack and never contained).

| Family | Classification (expected) | Best hypothesis | Decision | Incident raised? | Verdict | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `normal_traffic` | benign | insufficient_evidence | none | no | **PASS** | not treated as an attack; nothing surfaced |
| `customer_error` | benign | insufficient_evidence | none | no | **PASS** | not treated as an attack; nothing surfaced |
| `gateway_outage` | operational | insufficient_evidence | none | no | **PASS** | not treated as an attack; nothing surfaced |
| `retry_storm` | operational | insufficient_evidence | none | no | **PASS** | not treated as an attack; nothing surfaced |
| `flash_sale` | benign | insufficient_evidence | none | no | **PASS** | not treated as an attack; nothing surfaced |
| `attack_loud` | attack | attack | contain | yes | **PASS** | caught: contain, 63 cards on session |
| `attack_low_amplitude` | attack | attack | contain | yes | **PASS** | caught: contain, 15 cards on session |
| `attack_distributed` | attack | attack | contain | yes | **PASS** | caught: contain, 78 cards on network |
| `attack_carding` | attack | attack | contain | yes | **PASS** | caught: contain, 75 cards on session |
| `attack_proxy` | attack | attack | contain | yes | **PASS** | caught: contain, 87 cards on network |
| `attack_partial` | attack | attack | review | yes | **PASS** | caught: review, 69 cards on session |

## What each verdict means

- **PASS for an attack** = the winning explanation was `attack` *and* arbitration warranted a response (`contain` or `review`).
- **PASS for benign/operational** = the winning explanation was *not* `attack` *and* no customer-impacting action was taken (decision `monitor` or `none`).
- **Incident raised** mirrors `incidents.service`: an incident is surfaced to a person only when arbitration decides `contain` or `review`. A family that opens an internal incident which then arbitrates to `monitor`/`none` is *suppressed*, not raised.

## Assessment

The detector classified 11 of 11 families correctly: 6/6 attacks caught and warranted, and 5/5 benign/operational families left un-contained. None of the five benign or operational families surfaced an incident. `gateway_outage` produced the highest raw failure count here (29 failures across 29 sessions) and the rule tier still opened nothing to act on, because those failures are blamed on the gateway (100% of them) and spread across sessions rather than concentrated — the signature of an outage, not enumeration. Naming *which* not-an-attack each one is (outage versus dunning versus a busy afternoon) is the three-way comparison's job, in `comparison.service`; the claim this matrix makes is the narrower and more important one: nothing benign or operational was treated as an attack. `attack_low_amplitude` is the genuinely hard attack: one or two attempts per card spread over an hour, which never trips a per-minute rate. It is caught here (best=attack, decision=contain) on approval collapse and card-per-attempt over the full window — and would be invisible to a 30-minute burst detector, which is why the window is widened. `attack_distributed` is the one to read carefully — and the reason the detector evaluates a session, a device *and* a network on every pass. Enumeration is spread across a proxy pool at ~2.1 attempts per session, so no single session has the shape any rule needs. But the pool shares one /24 subnet, and the network correlation groups by /24 precisely so an attack that rotates sessions is still caught by the address block it comes from. The network entity therefore carries all 78 cards, `card_spread` fires, and it is contained (best=attack, decision=contain). An earlier version of this harness keyed the network on the full IP rather than the /24, which made the proxy pool look like dozens of unrelated networks and produced a false "the rule tier misses this" reading; mirroring production's subnet grouping is what corrected it. No family was misclassified: nothing benign or operational was treated as an attack, and no attack was missed.

## Per-family detail

| Family | Driver entity | Attempts | Failures | Cards | Approval | Shop approval | Gateway-blamed share | Top-session share | Rule-tier incidents opened | Runner-up (margin) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `normal_traffic` | — | — | — | — | — | 0.875 | 0.000 | 0.167 | 0/0 raised | — (—) |
| `customer_error` | — | — | — | — | — | 0.896 | 0.000 | 0.400 | 0/0 raised | — (—) |
| `gateway_outage` | — | — | — | — | — | 0.508 | 1.000 | 0.034 | 0/0 raised | — (—) |
| `retry_storm` | — | — | — | — | — | 0.250 | 0.000 | 0.528 | 0/0 raised | — (—) |
| `flash_sale` | — | — | — | — | — | 0.886 | 0.000 | 0.050 | 0/0 raised | — (—) |
| `attack_loud` | session | 63 | 61 | 63 | 0.032 | 0.032 | 0.000 | 1.000 | 1/1 raised | retry_storm (0.466) |
| `attack_low_amplitude` | session | 15 | 15 | 15 | 0.000 | 0.000 | 0.000 | 0.349 | 4/4 raised | retry_storm (0.466) |
| `attack_distributed` | network | 78 | 74 | 78 | 0.051 | 0.051 | 0.000 | 0.041 | 1/1 raised | retry_storm (0.375) |
| `attack_carding` | session | 75 | 70 | 75 | 0.067 | 0.067 | 0.000 | 1.000 | 1/1 raised | retry_storm (0.346) |
| `attack_proxy` | network | 87 | 83 | 87 | 0.046 | 0.046 | 0.000 | 0.060 | 1/1 raised | retry_storm (0.466) |
| `attack_partial` | session | 69 | 40 | 69 | 0.420 | 0.420 | 0.000 | 1.000 | 1/1 raised | retry_storm (0.204) |

_Generated by `scripts/scenario-run.mjs`. Structured results in `scenario-matrix.json`._
