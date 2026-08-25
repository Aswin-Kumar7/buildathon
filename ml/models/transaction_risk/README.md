# Transaction risk — Model A

An honest benchmark. The deliverable is not a leaderboard score; it is a **method** that does not
let a fraud model flatter itself, and a **leakage delta** that shows exactly how much a careless
split would have.

## Running it

```bash
pip install -r requirements.txt
make eval        # writes artifacts/metrics.json and artifacts/model_card.md
make test        # split integrity and reproducibility (pytest)
```

`make eval` is deterministic from a fixed seed: two runs produce byte-identical `metrics.json`, so
CI can regenerate and diff it. Drift means the model changed, not that the run was noisy.

## The data

The IEEE-CIS competition data is **not in this repository and never will be** — the rules forbid
redistribution, and Kaggle returns 403 on the download until you have joined the competition and
accepted its terms. `python -m transaction_risk.download_data` documents the one legitimate path.

Without it, the pipeline runs on a **deterministic synthetic stand-in** built to reproduce the one
structure the method exists to handle: fraud clustered by card over time. The leakage delta on
synthetic data is real; the absolute scores are a property of the generator, not of IEEE-CIS, and
every artefact says which source it used. Drop `train_transaction.csv` into `data/` to run for real.

## Why the split is the point

Fraud recurs on the same card. A random split scatters one card's transactions across train and
test, the model learns the card instead of the fraud, and its test score is inflated by a
recognition it cannot repeat on a card it has never seen. This pipeline:

- reconstructs the card identity (`card1 + addr1 + first-transaction-day`, recovered via `D1`),
- puts **whole cards** on one side of the split,
- orders the split by **time**, with a **delay gap** before the test period for the labels that
  would not yet have arrived,
- and reports the score of the careless split next to the honest one, so the gap is visible.
