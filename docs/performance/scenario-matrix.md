# Scenario matrix

> **Synthetic, seed-deterministic scenarios.** Every family below is generated in-process from `@sentinel/corpus` at its committed seed and run through the pure detection pipeline (`features -> rules -> cluster -> traffic -> arbitrate`, mirroring `apps/api/src/incidents/incidents.service.ts`). No live traffic, no database, no clock, no randomness: `node scripts/scenario-run.mjs` produces byte-identical output every time.

Threshold fingerprint `84bbf0ad` (production thresholds, unmodified). Observation window 600 min / half-life 5 min — widened from the production 30-minute window so an entire episode is in view for every family, the same choice `comparison.service.ts` makes. The thresholds are the ones production uses; only the observation period is widened.

**Result: 8/8 families classified correctly** (attacks caught and warranted; benign and operational traffic not treated as an attack and never contained).

| Family | Classification (expected) | Best hypothesis | Decision | Incident raised? | Verdict | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `normal_traffic` | benign | healthy_traffic | none | no | **PASS** | read as healthy, no action |
| `customer_error` | benign | healthy_traffic | none | no | **PASS** | read as healthy, no action |
| `gateway_outage` | operational | outage | monitor | no | **PASS** | read as outage, monitor only |
| `retry_storm` | operational | retry_storm | none | no | **PASS** | read as dunning, suppressed |
| `flash_sale` | benign | healthy_traffic | none | no | **PASS** | read as healthy, no action |
| `attack_loud` | attack | attack | contain | yes | **PASS** | caught: contain, 63 cards on session |
| `attack_low_amplitude` | attack | attack | contain | yes | **PASS** | caught: contain, 15 cards on session |
| `attack_distributed` | attack | attack | review | yes | **PASS** | arbitration flags attack (review); rule tier opened no incident — see assessment |

## What each verdict means

- **PASS for an attack** = the winning explanation was `attack` *and* arbitration warranted a response (`contain` or `review`).
- **PASS for benign/operational** = the winning explanation was *not* `attack` *and* no customer-impacting action was taken (decision `monitor` or `none`).
- **Incident raised** mirrors `incidents.service`: an incident is surfaced to a person only when arbitration decides `contain` or `review`. A family that opens an internal incident which then arbitrates to `monitor`/`none` is *suppressed*, not raised.

## Assessment

The detector classified 8 of 8 families correctly: 3/3 attacks caught and warranted, and 5/5 benign/operational families left un-contained. The two operational families are the ones an amateur counter gets wrong: `gateway_outage` has the highest failure count of any family here (29 failures across 29 sessions) yet reads as **outage** because the gateway is blamed for 100% of them and the failures are spread, not concentrated, and `retry_storm` reads as **retry_storm** because a few cards are hammered rather than a list walked. `attack_low_amplitude` is the genuinely hard attack: one or two attempts per card spread over an hour, which never trips a per-minute rate. It is caught here (best=attack, decision=contain) on approval collapse and card-per-attempt over the full window — and would be invisible to a 30-minute burst detector, which is why the window is widened. `attack_distributed` is the one to read carefully. Spread across a proxy pool at ~2.1 attempts per session, no single entity has enough shape to trip a discriminating rule, so the rule tier opens **0 incidents** — the burst gate genuinely does not catch it. The arbitration layer does: given the worst entity against shop traffic it reads **attack** and routes to **review**, carried by the shop-level `shop_failing_with_nobody_to_blame` expectation (shop approval 5%, gateway blamed for 0% of failures). So the detector's judgment is correct, but note the split: as `incidents.service` is currently wired, arbitration only runs on incidents the rule tier already opened, so this attack would not surface through the production incident pass without also arbitrating un-opened candidates. That is the single most important caveat in this matrix. No family was misclassified: nothing benign or operational was treated as an attack, and no attack was missed.

## Per-family detail

| Family | Driver entity | Attempts | Failures | Cards | Approval | Shop approval | Gateway-blamed share | Top-session share | Rule-tier incidents opened | Runner-up (margin) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `normal_traffic` | session (worst, no incident) | 1 | 1 | 1 | 0.000 | 0.875 | 0.000 | 0.167 | 0/0 raised | insufficient_evidence (0.372) |
| `customer_error` | session (worst, no incident) | 3 | 2 | 1 | 0.333 | 0.896 | 0.000 | 0.400 | 0/0 raised | insufficient_evidence (0.372) |
| `gateway_outage` | session (worst, no incident) | 1 | 1 | 1 | 0.000 | 0.508 | 1.000 | 0.034 | 0/0 raised | insufficient_evidence (0.393) |
| `retry_storm` | session (worst, no incident) | 24 | 19 | 4 | 0.208 | 0.250 | 0.000 | 0.528 | 0/0 raised | attack (0.171) |
| `flash_sale` | session (worst, no incident) | 2 | 1 | 2 | 0.500 | 0.886 | 0.000 | 0.050 | 0/0 raised | insufficient_evidence (0.352) |
| `attack_loud` | session | 63 | 61 | 63 | 0.032 | 0.032 | 0.000 | 1.000 | 1/1 raised | retry_storm (0.466) |
| `attack_low_amplitude` | session | 15 | 15 | 15 | 0.000 | 0.000 | 0.000 | 0.349 | 5/5 raised | retry_storm (0.466) |
| `attack_distributed` | session (worst, no incident) | 3 | 3 | 3 | 0.000 | 0.051 | 0.000 | 0.041 | 0/0 raised | insufficient_evidence (0) |

_Generated by `scripts/scenario-run.mjs`. Structured results in `scenario-matrix.json`._
