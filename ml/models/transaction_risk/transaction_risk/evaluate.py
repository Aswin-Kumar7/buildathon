"""Measuring the model on data it never saw, and saying how sure we are of each number.

A single precision figure on a test set is a point estimate that a reader has no way to weigh. So
every headline number here comes with a bootstrap confidence interval — resample the test set, re-
measure, and report the spread — because "0.71" and "0.71, give or take 0.15" are different claims
and only one of them is honest about a small test set.

The calibration numbers are here for the same reason the model is calibrated at all: a fraud score
that feeds a cost-based decision has to *mean* what it says, and the Brier score and the reliability
curve are how that is checked rather than assumed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.calibration import calibration_curve
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)


@dataclass
class Interval:
    point: float
    low: float
    high: float


@dataclass
class Evaluation:
    n_test: int
    positives: int
    threshold: float
    precision: Interval
    recall: Interval
    pr_auc: Interval
    roc_auc: float
    brier: float
    reliability: list[dict[str, float]] = field(default_factory=list)


def _bootstrap(
    y: np.ndarray, probs: np.ndarray, threshold: float, seed: int, rounds: int = 1000
) -> dict[str, Interval]:
    rng = np.random.default_rng(seed)
    n = len(y)
    precisions, recalls, praucs = [], [], []

    for _ in range(rounds):
        idx = rng.integers(0, n, size=n)
        yb, pb = y[idx], probs[idx]
        if yb.sum() == 0 or yb.sum() == len(yb):
            # A resample with no positives (or no negatives) cannot yield precision/recall; skip it
            # rather than let a degenerate draw distort the interval.
            continue
        predicted = pb >= threshold
        precisions.append(precision_score(yb, predicted, zero_division=0))
        recalls.append(recall_score(yb, predicted, zero_division=0))
        praucs.append(average_precision_score(yb, pb))

    def interval(point: float, samples: list[float]) -> Interval:
        if not samples:
            return Interval(point=point, low=point, high=point)
        return Interval(point=point, low=float(np.percentile(samples, 2.5)),
                        high=float(np.percentile(samples, 97.5)))

    predicted = probs >= threshold
    return {
        "precision": interval(float(precision_score(y, predicted, zero_division=0)), precisions),
        "recall": interval(float(recall_score(y, predicted, zero_division=0)), recalls),
        "pr_auc": interval(float(average_precision_score(y, probs)), praucs),
    }


def evaluate(y: np.ndarray, probs: np.ndarray, threshold: float, seed: int) -> Evaluation:
    """The held-out report: point estimates, intervals, ranking quality, and calibration."""
    intervals = _bootstrap(y, probs, threshold, seed)

    fraction_positive, mean_predicted = calibration_curve(y, probs, n_bins=10, strategy="quantile")
    reliability = [
        {"predicted": float(p), "observed": float(o)}
        for p, o in zip(mean_predicted, fraction_positive)
    ]

    return Evaluation(
        n_test=int(len(y)),
        positives=int(y.sum()),
        threshold=float(threshold),
        precision=intervals["precision"],
        recall=intervals["recall"],
        pr_auc=intervals["pr_auc"],
        roc_auc=float(roc_auc_score(y, probs)),
        brier=float(brier_score_loss(y, probs)),
        reliability=reliability,
    )


def ranking_score(y: np.ndarray, probs: np.ndarray) -> float:
    """Area under the precision-recall curve — the ranking metric the leakage delta is measured in.

    PR-AUC rather than ROC-AUC because fraud is rare, and ROC-AUC flatters a model on imbalanced
    data by rewarding it for the easy true negatives it was never going to get wrong.
    """
    return float(average_precision_score(y, probs))
