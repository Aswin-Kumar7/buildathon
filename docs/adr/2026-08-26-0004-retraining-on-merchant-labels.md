# ADR-0004 — Retraining the risk model on the merchant's own confirmed labels

**Date:** 2026-08-26
**Status:** accepted

## Context

The deployed card-testing risk model is trained on a synthetic scenario corpus, because no public
dataset carries real card-testing labels in the feature space this detector works in. IEEE-CIS is real
but a different loss event (post-authorisation fraud, not pre-authorisation decline bursts) and lacks
the session/network correlation and approval-collapse signals this model rests on. So the honest
statement on the model page is that the labels are **synthetic, not real-world outcomes**.

That is defensible as a cold start, but a security product that never learns from the merchant it
protects is a demo, not a product. The one place real card-testing labels exist is the merchant's own
traffic over time: incidents an analyst confirmed, and chargebacks that settle weeks later. The
constraint is that those labels arrive **late and in small numbers**, and they must attach to the
**exact features the decision was made on** — not features recomputed later against data that may have
changed — or the training set quietly drifts from what the model actually saw.

## Decision

Capture the training example at decision time and attach the label when it is confirmed:

- Every incident stores, at each evaluation, the **feature vector the decision rested on**
  (`incidents.features`) and the model's risk on it (`incidents.model_risk`).
- When an analyst resolves an incident, they may give a **verdict** — `confirmed_abuse` or
  `false_positive` — which writes `label` (1 or 0), `label_source`, `labeled_at` and `labeled_by`.
  Containing an incident implies `confirmed_abuse` on its own. A chargeback feed can write the same
  label with `label_source = 'chargeback'` when one settles.
- `export_labels.mjs` reads the confirmed labels — **real traffic only**, because a replayed scenario
  is not evidence — into `data/merchant_labels.csv`, in the same feature columns the synthetic corpus
  uses.
- `incident/data.py` loads that file alongside the synthetic corpus when it is present, and the
  metrics provenance flips to `synthetic+merchant` with the real-label count. The same `make eval`
  path runs whether or not real labels exist, so the day they do, nothing has to change to use them.

As real labels accumulate they come to dominate the training set, and the number on the model page
comes to describe the model on the merchant's own traffic — which is the only way the synthetic
disclaimer is ever earned away.

## Alternatives considered

| Option | Why not |
|---|---|
| Recompute features at retraining time from stored events | The events behind an old incident may be purged (forensic retention) or reinterpreted; the label must attach to the numbers the model actually scored, so we snapshot them. |
| A separate `labeled_examples` table | Real dual-write and lifecycle sync for no gain; the incident already is the example, and columns on it stay consistent by construction. |
| Infer the label purely from the terminal status | `resolved` is ambiguous (handled-abuse vs false alarm). An explicit verdict keeps the label honest; containment is the one status that implies abuse on its own. |
| Keep training synthetic-only and never learn | A detector that cannot improve on the merchant it protects is not a product, and leaves the synthetic disclaimer permanent. |

## Consequences

- **Easy:** the model has a real path off synthetic labels, and it is the same path in code whether or
  not real data exists yet — so there is nothing to build later, only data to accumulate.
- **Easy:** every confirmed decision is auditable back to the exact features and the person who
  confirmed it (`labeled_by`, and the audit chain entry).
- **Hard:** the labels are delayed and imbalanced, and confirmation is itself a noisy signal (an
  analyst can be wrong). Retraining must weight real labels carefully and watch for drift — the
  champion/challenger and drift monitoring that a production deployment would add on top of this seam.
- **Hard:** in the credential-free demo the database is in-process and traffic is replayed, so the
  export is honestly empty until the system runs against real Razorpay traffic. The capture is live;
  the corpus of real labels is not something a demo can fake.
