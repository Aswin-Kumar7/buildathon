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

from .config import REVIEW_CAP


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
    # The operating point as a shopper feels it and an operations team has to staff it.
    false_decline_rate: float = 0.0
    block_rate: float = 0.0
    review_rate: float = 0.0
    review_threshold: float = 0.0
    reliability: list[dict[str, float]] = field(default_factory=list)


def operating_point(
    y: np.ndarray, probs: np.ndarray, block_threshold: float, review_cap: float
) -> dict[str, float]:
    """The three-way operating point: what fraction is blocked, reviewed, and wrongly declined.

    The block threshold is the cost-optimal one and is not touched here — this only *reports* the
    consequences of running at it, plus a review band. The review band takes the highest-risk
    transactions that were **not** blocked, up to a fixed share of all traffic (the analyst budget),
    because human review is a capacity, not a free tier: a model that flags a tenth of traffic for
    review has not saved anyone money if nobody can look at it.

    The false-decline rate — legitimate shoppers wrongly blocked, as a share of all legitimate
    traffic — is the number a merchant actually feels, and the one a precision figure hides when
    fraud is rare.
    """
    predicted_block = probs >= block_threshold
    negatives = int(np.sum(y == 0))
    false_positives = int(np.sum(predicted_block & (y == 0)))
    n = len(y)

    budget = int(np.floor(review_cap * n))
    below = probs[~predicted_block]
    if budget > 0 and below.size > 0:
        ranked = np.sort(below)[::-1]
        take = int(min(budget, ranked.size))
        review_threshold = float(ranked[take - 1]) if take > 0 else float(block_threshold)
        review_rate = take / n
    else:
        review_threshold = float(block_threshold)
        review_rate = 0.0

    return {
        "false_decline_rate": (false_positives / negatives) if negatives else 0.0,
        "block_rate": float(np.mean(predicted_block)),
        "review_rate": float(review_rate),
        "review_threshold": review_threshold,
    }


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


def evaluate(
    y: np.ndarray, probs: np.ndarray, threshold: float, seed: int, review_cap: float = REVIEW_CAP
) -> Evaluation:
    """The held-out report: point estimates, intervals, ranking quality, calibration, and the
    three-way operating point a team actually runs and staffs."""
    intervals = _bootstrap(y, probs, threshold, seed)
    operating = operating_point(y, probs, threshold, review_cap)

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
        false_decline_rate=operating["false_decline_rate"],
        block_rate=operating["block_rate"],
        review_rate=operating["review_rate"],
        review_threshold=operating["review_threshold"],
        reliability=reliability,
    )


def ranking_score(y: np.ndarray, probs: np.ndarray) -> float:
    """Area under the precision-recall curve — the ranking metric the leakage delta is measured in.

    PR-AUC rather than ROC-AUC because fraud is rare, and ROC-AUC flatters a model on imbalanced
    data by rewarding it for the easy true negatives it was never going to get wrong.
    """
    return float(average_precision_score(y, probs))
