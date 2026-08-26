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

`make eval` is deterministic from a fixed seed: two runs produce byte-identical `metrics.json`.
`make check-metrics` regenerates and diffs it — verifying against the real data when the data is
present, and falling back to a synthetic determinism check when it is not (a clean clone, or CI),
so the gate never fails for want of data it is not allowed to hold.

## The data, and the model

**The committed `metrics.json` and `model_card.md` are from the real IEEE-CIS data.** What is *not*
committed — and never will be — is the data itself: the competition rules forbid redistributing it
(§7.B), Kaggle 403s the download until you have joined and accepted the terms, and it is gitignored
here so it cannot slip in. Publishing a **model trained on the data**, and its metrics, is a
different thing the rules permit — §8.B explicitly contemplates sharing a "model containing or
depending on such Competition Code" under an open-source licence, which this repository carries
(MIT). The data is used only for the non-commercial, educational purpose §7.A allows.

So a reader of this repository sees the **real held-out numbers** without the data. To *reproduce*
them, place `train_transaction.csv` in `data/` (see `download_data.py`) and re-run — `check-metrics`
will then verify them against your machine. Absent the data, the pipeline falls back to a
**deterministic synthetic stand-in** built to reproduce the one structure the method exists to
handle (fraud clustered by card over time); a bare `make eval` on a clean clone writes those
synthetic numbers to `metrics.synthetic.json` rather than overwriting the committed real result.
Every artefact records which source produced it.

## Why the split is the point

Fraud recurs on the same card. A random split scatters one card's transactions across train and
test, the model learns the card instead of the fraud, and its test score is inflated by a
recognition it cannot repeat on a card it has never seen. This pipeline:

- reconstructs the card identity (`card1 + addr1 + first-transaction-day`, recovered via `D1`),
- puts **whole cards** on one side of the split,
- orders the split by **time**, with a **delay gap** before the test period for the labels that
  would not yet have arrived,
- and reports the score of the careless split next to the honest one, so the gap is visible.
