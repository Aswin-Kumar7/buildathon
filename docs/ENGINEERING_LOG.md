# Engineering log

Things that broke, or were quietly wrong, and what it took to find them. Real ones only, roughly in
the order we hit them. Each names a file so you can go and check.

Why the system is shaped the way it is belongs in [DECISIONS](DECISIONS.md), not here.

| #   | What went wrong                                                                                            | Where       |
| :-- | :--------------------------------------------------------------------------------------------------------- | :---------- |
| 1   | [42,628 cards were sitting on both sides of the split](#1--42628-cards-were-sitting-on-both-sides-of-the-split) | ML          |
| 2   | [The library we picked crashed the machine](#2--the-library-we-picked-crashed-the-machine)                   | ML          |
| 3   | [`make eval` blew the CI time budget](#3--make-eval-blew-the-ci-time-budget)                                 | ML          |
| 4   | [The two implementations disagreed at the eighth decimal](#4--the-two-implementations-disagreed-at-the-eighth-decimal) | ML          |
| 5   | [A distributed attack looked undetectable](#5--a-distributed-attack-looked-undetectable)                     | Detection   |
| 6   | [One feature pointed the detector backwards](#6--one-feature-pointed-the-detector-backwards)                 | Detection   |
| 7   | [The first simulation after a restart detected nothing](#7--the-first-simulation-after-a-restart-detected-nothing) | API         |
| 8   | [`position: sticky` had never worked in the console](#8--position-sticky-had-never-worked-in-the-console)    | Console     |
| 9   | [A gradient started 188 pixels short](#9--a-gradient-started-188-pixels-short)                               | Console     |
| 10  | [The policy ledger invented its own history](#10--the-policy-ledger-invented-its-own-history)                | Console     |
| 11  | [A badge and the page beside it counted different things](#11--a-badge-and-the-page-beside-it-counted-different-things) | Console     |
| 12  | [An evidence row asserted the opposite of its own rule](#12--an-evidence-row-asserted-the-opposite-of-its-own-rule) | Console     |
| 13  | [Three Azure regions would not take the deployment](#13--three-azure-regions-would-not-take-the-deployment) | Deploy |

---

## 1 · 42,628 cards were sitting on both sides of the split

- **Symptom.** The first model here trained on IEEE-CIS and scored PR-AUC 0.527 on a held-out set. A
  good number.
- **Cause.** It was not a held-out set. The split was row-wise, so 42,628 cards had some of their
  transactions in training and the rest in test. The model was being rewarded for recognising a card
  it had already met rather than for spotting fraud.
- **Fix.** Split by card, and drop the 53,928 rows straddling the boundary. The same model came down
  to 0.363.

That 0.164 is why every split in this repository is grouped, including the synthetic one, where the
same measurement is published even though the gap there is negligible. A number you did not try to
break is not a result yet.

## 2 · The library we picked crashed the machine

- **Symptom.** LightGBM segfaulted on this Python install, every run.
- **Cause.** A native library problem, nothing to do with the model.
- **Fix.** Swapped in scikit-learn's `HistGradientBoostingClassifier`. Same family, already a
  dependency, and it ran.

Worth being plain about: that was not a considered model choice, it was the one that started. What
makes it defensible afterwards is the ladder in `ml/models/incident/incident/ladder.py`, which
re-proves the choice against a linear model and a random forest on every build. If it stops being the
right call, the build says so.

## 3 · `make eval` blew the CI time budget

- **Symptom.** Evaluation was far too slow to sit on every push.
- **Cause.** The tree walker descended one row at a time through 200 trees. Correct, and hopeless at
  that scale.
- **Fix.** Rewritten so every row descends each tree together, as array operations
  (`ml/models/incident/incident/model.py`). Same numbers, fast enough that `check:metrics` can be a
  gate rather than an overnight job.

The rewrite carries an assertion that every row really did land on a leaf, because a vectorised walk
that quietly stops early still returns a perfectly plausible number.

## 4 · The two implementations disagreed at the eighth decimal

- **Symptom.** The Python/TypeScript parity test failed at 3.1e-8.
- **Cause.** Not a logic bug. `export.py` was rounding tree values to eight decimal places, and
  across 200 trees that rounding piled up past the test's bar.
- **Fix.** Export precision raised to ten.

It matters more than the size of the number suggests, because "the model you are served is the model
we trained" is a claim we make out loud. A tolerance loose enough to pass a real divergence is
decoration, not a check.

## 5 · A distributed attack looked undetectable

- **Symptom.** `attack_distributed` scored as nothing at every entity kind. We nearly wrote it up as
  a genuine limit of the approach.
- **Cause.** The network entity was keyed on the full IP address. A proxy pool running two attempts
  per session looked like dozens of unrelated single-attempt networks, so nothing concentrated
  anywhere.
- **Fix.** Key on the `/24` subnet, which is what makes a shared pool visible at all.

A measured miss is not automatically a model limitation. This one was a bug wearing a result's
clothes, and it would have shipped as a documented weakness.

## 6 · One feature pointed the detector backwards

- **Symptom.** `infra_share` read close to 1.0 for a dunning run, the opposite of what it is for.
- **Cause.** The feature answers "is the acquirer at fault here", but it was counting both `gateway`
  and `bank` failures as infrastructure. An issuer declining a card is recorded as a `bank` failure,
  and that is exactly what enumeration produces.
- **Fix.** Only `gateway` counts, because only `gateway` names a component that broke rather than a
  card that was refused. The comment in `packages/detect/src/features.ts` now explains this at the
  field.

## 7 · The first simulation after a restart detected nothing

- **Symptom.** Traffic generated, nothing appeared, nothing in the logs.
- **Cause.** The run seed came from an in-memory counter that reset to zero on every boot. Event ids
  are a pure function of that seed, and the inbox has a unique constraint with `onConflictDoNothing`,
  so the first run after a restart regenerated ids the inbox had already seen and silently discarded
  every one of them.
- **Fix.** The seed now comes from the row count in `simulation_runs`, which is append-only and
  untouched by any reset, so it only ever climbs
  (`apps/api/src/replay/simulation.service.ts`).

The silence is the part worth remembering. A dedup working correctly and a bug producing nothing look
identical from outside.

## 8 · `position: sticky` had never worked in the console

- **Symptom.** A scroll-driven section refused to pin, and every property on it was correct.
- **Cause.** `html { overflow-y: auto }`, set somewhere else entirely to hide a scrollbar, had turned
  the root element into a scroll container. Inside one, `position: sticky` stops sticking with no
  warning, no error, and nothing in devtools to look at.
- **Fix.** `body { overflow-x: clip }` in `apps/web/src/index.css`, with the reason written beside it.
  `clip` and not `hidden`, because `hidden` creates the same scroll container and brings the bug
  straight back.

## 9 · A gradient started 188 pixels short

- **Symptom.** The landing page's corner light was supposed to reach the screen edge and stopped
  short of it.
- **Cause.** It was held back by `calc(-1 * var(--lp-gutter))`, a variable used correctly everywhere
  else on the page. That variable holds a percentage, and a percentage inside a CSS custom property
  resolves where it is _used_, not where it is defined. On the section it came out as 240px; on the
  glow, whose containing block was a narrower panel, the same variable came out as 52px.
- **Fix.** Stop pulling the glow out with the gutter variable at all. It now spans its panel edge
  to edge (`left: 0; right: 0`), and that panel's left edge already is the page gutter
  (`apps/web/src/landing/Landing.css`).

## 10 · The policy ledger invented its own history

- **Symptom.** Found by audit, not by anyone using it, which is rather the point.
- **Cause.** The policy history page carried a hardcoded six-row fallback for when the database had
  no versions. Invented actors, invented hashes, invented timestamps. It rendered under an
  "Append-only" badge, counted toward the record total, and went into the CSV export.
- **Fix.** Fallback deleted, replaced with a real empty state.

One of the fake hashes matched a real one, because the array had been copied out of a live run. That
is what let it survive review. It never shipped, because it was still in the working tree when we
caught it. Placeholder data is normal and usually harmless. It stops being harmless the moment it
fills a surface claiming to be a tamper-evident record.

## 11 · A badge and the page beside it counted different things

- **Symptom.** On the data we had at the time, the sidebar Attempts badge would have read 2 while the
  page next to it read 479. Same label, same screen.
- **Cause.** The badge fetched `/api/attempts/rows` with no `source` parameter, and the controller
  defaults a missing source to `razorpay`. The page hard-codes `source=all`.
- **Fix.** The badge now sends `source=all` and validates the response against the shared schema.

The bug was in the absence of a parameter, which is invisible in review.

## 12 · An evidence row asserted the opposite of its own rule

- **Symptom.** The machine-cadence row rendered `OBSERVED 0.12 · EXPECTED LIMIT ≥ 0.35`, a value
  below a floor it was apparently above.
- **Cause.** The comparator was picked with `/below|floor/.test(code)`. Two rules fire on a
  lower-than test: `approval_rate_below_floor` matches that pattern and
  `inter_arrival_variation_low` does not, so one row rendered backwards.
- **Fix.** An explicit set naming both codes, plus a test covering all seven evidence codes.

The pattern had encoded an assumption about naming that the naming never promised to keep.

## 13 · Three Azure regions would not take the deployment

- **Symptom.** Provisioning would not complete in any of the regions closest to the traffic, and each
  one refused for a different reason.
- **Cause.** The free subscription behind this deployment is constrained twice over, by an
  allowed-regions policy and by Container Apps quota that does not follow it.
- **Fix.** `LOCATION: uaenorth` in `.github/workflows/azure-setup.yml`, with the table below written
  into the comment above the setting and `malaysiawest` and `koreacentral` named as the remaining
  fallbacks.

| Region              | Outcome                                          |
| :------------------ | :----------------------------------------------- |
| Central India       | Allowed by policy, no Container Apps quota       |
| South Central India | Allowed by policy, Container Apps not offered    |
| Singapore           | Has quota, blocked by the allowed-regions policy |
| UAE North           | Allowed, offered, and has quota                  |

Mumbai was the right answer on latency, since Razorpay is India-based and the webhook round trip is
what matters. Dubai is roughly 30-50 ms from India against Mumbai's 10-20 ms, which is noise inside a
five-second acknowledgement budget, so the constraint cost nothing that shows up where it counts.
Recorded next to the setting because "why is this in the UAE" is a fair question to ask of a payments
project.
