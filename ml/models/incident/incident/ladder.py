"""The model ladder: is the served model class the right one?

The ladder is why the served model is what it is. It was run while a temperature-scaled logistic
regression was in production, on the same grouped split and the same cost model, and it said plainly
that a gradient-boosted ensemble reached PR-AUC 0.991 against 0.940 and roughly halved the cost of
being wrong — on every one of five re-splits. Publishing that and continuing to serve the loser would
have been a strange thing to do, so the ensemble was promoted and the linear model became the
alternative it is measured against.

It keeps running for the same reason it did then. A ladder that only ever confirms the incumbent is a
ladder nobody needed to build, and the interesting outcome is the one where the simpler model turns
out to be enough — that result would be worth having too, and this is what would surface it.

The two alternatives fail differently on purpose. A linear model cannot represent an interaction at
all; a random forest averages independent trees rather than fitting residuals sequentially. If the
served ensemble beats both by a similar margin, the margin is a property of the model class rather
than of one library's hyperparameters.

Everything here is deterministic — fixed seeds, single-threaded fitting, rounded output — because
`check-metrics` regenerates these numbers in CI and byte-compares them against the committed file.
"""

from __future__ import annotations

from typing import Callable

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import brier_score_loss

from .config import CostModel, SEED
from .evaluate import ranking_score
from .model import cost_optimal_threshold, train, train_trees
from .split import Split, grouped_split

# The seeds the stability check re-splits on. A single split can flatter any model; the question that
# matters is whether the ordering survives being asked again. Fixed, so the run stays reproducible.
STABILITY_SEEDS: tuple[int, ...] = (SEED, 1, 7, 42, 99)

SERVED = "hist-gradient-boosting-temperature"

#: Each alternative reduces to the same thing: risk on validation (to pick a threshold) and risk on
#: test (to score it). Wrapping them this way lets a hand-built pipeline and a bare sklearn estimator
#: sit on the same ladder without one of them getting a different evaluation.
Scorer = Callable[[np.ndarray, np.ndarray, Split, CostModel], tuple[np.ndarray, np.ndarray]]


def _served(x: np.ndarray, y: np.ndarray, split: Split, cost: CostModel):
    model = train_trees(x[split.train], y[split.train], x[split.validation], y[split.validation], cost)
    return model.risk(x[split.validation]), model.risk(x[split.test])


def _logistic(x: np.ndarray, y: np.ndarray, split: Split, cost: CostModel):
    model = train(x[split.train], y[split.train], x[split.validation], y[split.validation], cost)
    return model.risk(x[split.validation]), model.risk(x[split.test])


def _random_forest(x: np.ndarray, y: np.ndarray, split: Split, cost: CostModel):
    # `n_jobs` is left at one thread deliberately: a parallel forest can sum floats in a different
    # order between runs, and `check-metrics` compares bytes.
    forest = RandomForestClassifier(
        n_estimators=300, random_state=SEED, min_samples_leaf=3, n_jobs=1
    ).fit(x[split.train], y[split.train])
    return (
        forest.predict_proba(x[split.validation])[:, 1],
        forest.predict_proba(x[split.test])[:, 1],
    )


ALTERNATIVES: tuple[tuple[str, Scorer], ...] = (
    ("logistic-temperature", _logistic),
    ("random-forest", _random_forest),
)


def _score(y_test: np.ndarray, risk_test: np.ndarray, threshold: float, cost: CostModel) -> dict:
    predicted = risk_test >= threshold
    true_pos = int(np.sum(predicted & (y_test == 1)))
    false_pos = int(np.sum(predicted & (y_test == 0)))
    false_neg = int(np.sum(~predicted & (y_test == 1)))
    precision = true_pos / (true_pos + false_pos) if true_pos + false_pos else 0.0
    recall = true_pos / (true_pos + false_neg) if true_pos + false_neg else 0.0
    return {
        "pr_auc": round(float(ranking_score(y_test, risk_test)), 6),
        "precision": round(float(precision), 6),
        "recall": round(float(recall), 6),
        "brier": round(float(brier_score_loss(y_test, risk_test)), 6),
        "threshold": round(float(threshold), 6),
        "cost_paise": (
            false_neg * cost.false_negative_paise + false_pos * cost.false_positive_paise
        ),
    }


def _run(name: str, scorer: Scorer, x, y, split: Split, cost: CostModel, served: bool) -> dict:
    val_risk, test_risk = scorer(x, y, split, cost)
    threshold = cost_optimal_threshold(y[split.validation], val_risk, cost)
    return {"model": name, "served": served, **_score(y[split.test], test_risk, threshold, cost)}


def model_ladder(x: np.ndarray, y: np.ndarray, split: Split, cost: CostModel) -> list[dict]:
    """Every model class on the same split, the served one first. Ordered as written rather than by
    score — a reader should see the incumbent before the comparison, not after a ranking has already
    editorialised about it."""
    rows = [_run(SERVED, _served, x, y, split, cost, served=True)]
    served_pr, served_cost = rows[0]["pr_auc"], rows[0]["cost_paise"]
    for name, scorer in ALTERNATIVES:
        row = _run(name, scorer, x, y, split, cost, served=False)
        row["pr_auc_delta"] = round(row["pr_auc"] - served_pr, 6)
        row["cost_delta_paise"] = row["cost_paise"] - served_cost
        rows.append(row)
    return rows


def ladder_stability(
    x: np.ndarray, y: np.ndarray, groups: np.ndarray, cost: CostModel,
    test_fraction: float, validation_fraction: float,
) -> dict:
    """Re-split and re-run the closest comparison, so the margin is reported with its spread rather
    than as a single number. A gap that survives five different groupings of the same corpus is a
    property of the model class; a gap that does not is a property of the split.

    `pr_auc_delta` is signed from the alternative's point of view, exactly as in the ladder above: a
    negative mean means the served model is ahead.
    """
    name, scorer = ALTERNATIVES[0]
    deltas: list[float] = []
    cost_deltas: list[int] = []
    for seed in STABILITY_SEEDS:
        split = grouped_split(groups, test_fraction, validation_fraction, seed=seed)
        served = _run(SERVED, _served, x, y, split, cost, served=True)
        other = _run(name, scorer, x, y, split, cost, served=False)
        deltas.append(other["pr_auc"] - served["pr_auc"])
        cost_deltas.append(other["cost_paise"] - served["cost_paise"])

    array = np.array(deltas)
    return {
        "compared_with": name,
        "n_seeds": len(STABILITY_SEEDS),
        "seeds": list(STABILITY_SEEDS),
        "pr_auc_delta": {
            "mean": round(float(array.mean()), 6),
            "sd": round(float(array.std()), 6),
            "min": round(float(array.min()), 6),
            "max": round(float(array.max()), 6),
        },
        "served_wins": int((array < 0).sum()),
        "mean_cost_delta_paise": int(round(float(np.mean(cost_deltas)))),
    }
