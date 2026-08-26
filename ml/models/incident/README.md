# Card-testing risk model

The one deployed model. A calibrated **binary logistic** that scores an entity's risk of being card
testing / abuse — **P(abuse)** — trained and evaluated on the synthetic scenario corpus, and served
in the request path. It is linear and temperature-scaled, so the API serves it directly as a few dot
products — no native runtime — and its per-feature contributions are exact for a linear model.

The number the model page reports is **this** model's, on a held-out split of the same corpus it was
trained on. There is no separate benchmark model: the model you see precision/recall/PR-AUC for is
the model the merchant actually runs. The IEEE-CIS work remains only as supporting research, never
the product's headline.

```bash
pip install -r requirements.txt
node export_training.mjs   # regenerate training.csv from the corpus (same @sentinel/detect features the API uses)
make eval                  # writes model.json, registry.json, metrics.json, model_card.md, METRICS.md
make test                  # split integrity, served-model parity, reproducibility, the synthetic-label claim
make check-metrics         # regenerate in memory and fail if metrics.json drifted
```

`make eval` is deterministic from a fixed seed, so two runs produce byte-identical `metrics.json`.

## Honesty discipline

- **The labels are synthetic, not real-world outcomes.** Every row is an entity from a seeded
  scenario the project authored; the label is the scenario's ground truth, not a confirmed
  chargeback. The path to real labels is the merchant's own confirmed incidents — see the retraining
  design. `make eval` writes that disclaimer into every artefact.
- **A corpus with genuine overlap.** The eight committed families are trivially separable, so the
  corpus is hardened with realistic boundary cases — a tester reusing a small card pool (dunning-
  shaped), a benign batch walking many cards (enumeration-shaped), attacks masked inside real traffic
  and inside an outage. The per-origin breakdown shows the model catches the obvious cases and
  struggles exactly where card testing and a biller's dunning genuinely overlap.
- **Grouped split.** Rows are grouped by scenario instance; a seed the model trained on never appears
  in the test set, so the score measures generalisation, not memory.
- **Cost-optimal operating point.** The block threshold minimises expected cost from declared
  false-negative and false-positive costs, not an abstract metric — reported with the three-way
  operating point (observe / review / contain-eligible) a team would actually staff.
- **Calibration and intervals.** Every headline number carries a bootstrap confidence interval, and
  the reliability curve and Brier score show the probabilities mean what they say.
- **Leakage delta.** The grouped-split score beside a careless row-wise one. Small on a single-
  generator synthetic corpus, and honestly so — the dramatic leakage story belongs to the real-data
  IEEE-CIS research benchmark, not here.

## Load-bearing, but leashed

The model feeds the decision alongside the deterministic rules and arbitration: it can escalate a
case the rules would have suppressed, hold back a containment it disputes, or raise a case the rules
never opened. It never contains a shopper on its own — the strongest thing it can do is send a case
to a person. When the artefact is absent, the request path runs on rules alone (`degraded:model`).
