"""Measuring the deployed model on entities it never saw, and saying how sure we are of each number.

A single precision figure on a test set is a point estimate a reader cannot weigh, so every headline
number comes with a bootstrap confidence interval — resample the test set, re-measure, report the
spread. The calibration numbers (Brier, reliability curve) are here for the same reason the model is
calibrated at all: a risk score that feeds a cost-based decision has to *mean* what it says.

The per-origin breakdown is the honest heart of it. It reports, for each scenario family and
composition, how often the model was right — so a reader sees the model catch the obvious attacks and
struggle exactly where card testing and a biller's dunning genuinely overlap, rather than trusting an
aggregate that hides both.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.calibration import calibration_curve
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
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
    f1: Interval
    pr_auc: Interval
    roc_auc: float
    brier: float
    false_decline_rate: float = 0.0
    block_rate: float = 0.0
    review_rate: float = 0.0
    review_threshold: float = 0.0
    reliability: list[dict[str, float]] = field(default_factory=list)
    per_origin: list[dict] = field(default_factory=list)


def operating_point(
    y: np.ndarray, risk: np.ndarray, block_threshold: float, review_cap: float
) -> dict[str, float]:
    """The three-way operating point: what fraction is contained-eligible, reviewed, wrongly flagged.

    The block threshold is the cost-optimal one and is not touched here — this reports the consequences
    of running at it, plus a review band that takes the highest-risk entities **not** blocked, up to a
    fixed share of all traffic (the analyst budget). Human review is a capacity, not a free tier.

    The false-decline rate — benign entities the model would put on the block-eligible side, as a share
    of all benign traffic — is the number a merchant feels. It is *eligibility*, not an actual block:
    the model only routes; the deterministic rules and policy still gate whether anything is done.
    """
    predicted_block = risk >= block_threshold
    negatives = int(np.sum(y == 0))
    false_positives = int(np.sum(predicted_block & (y == 0)))
    n = len(y)

    budget = int(np.floor(review_cap * n))
    below = risk[~predicted_block]
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
    y: np.ndarray, risk: np.ndarray, threshold: float, seed: int, rounds: int = 1000
) -> dict[str, Interval]:
    rng = np.random.default_rng(seed)
    n = len(y)
    precisions, recalls, f1s, praucs = [], [], [], []

    for _ in range(rounds):
        idx = rng.integers(0, n, size=n)
        yb, pb = y[idx], risk[idx]
        if yb.sum() == 0 or yb.sum() == len(yb):
            continue
        predicted = pb >= threshold
        precisions.append(precision_score(yb, predicted, zero_division=0))
        recalls.append(recall_score(yb, predicted, zero_division=0))
        f1s.append(f1_score(yb, predicted, zero_division=0))
        praucs.append(average_precision_score(yb, pb))

    def interval(point: float, samples: list[float]) -> Interval:
        if not samples:
            return Interval(point=point, low=point, high=point)
        return Interval(
            point=point,
            low=float(np.percentile(samples, 2.5)),
            high=float(np.percentile(samples, 97.5)),
        )

    predicted = risk >= threshold
    return {
        "precision": interval(float(precision_score(y, predicted, zero_division=0)), precisions),
        "recall": interval(float(recall_score(y, predicted, zero_division=0)), recalls),
        "f1": interval(float(f1_score(y, predicted, zero_division=0)), f1s),
        "pr_auc": interval(float(average_precision_score(y, risk)), praucs),
    }


def per_origin(y: np.ndarray, risk: np.ndarray, origin: np.ndarray, threshold: float) -> list[dict]:
    """How the model does on each scenario family and composition — where it is right, where it isn't.

    For a positive origin (an attack) the number that matters is recall: what share it caught. For a
    benign origin, it is the false-positive rate: what share it wrongly flagged. Reporting both, per
    origin, is what turns an aggregate into an argument a reader can check.
    """
    predicted = risk >= threshold
    rows = []
    for name in sorted(set(origin.tolist())):
        mask = origin == name
        yo, po = y[mask], predicted[mask]
        positives = int(yo.sum())
        rows.append(
            {
                "origin": name,
                "n": int(mask.sum()),
                "positive": positives > 0,
                "recall": float((po[yo == 1] == 1).mean()) if positives else None,
                "false_positive_rate": float((po[yo == 0] == 1).mean()) if (mask.sum() - positives) else None,
                "mean_risk": float(risk[mask].mean()),
            }
        )
    return rows


def evaluate(
    y: np.ndarray,
    risk: np.ndarray,
    origin: np.ndarray,
    threshold: float,
    seed: int,
    review_cap: float = REVIEW_CAP,
) -> Evaluation:
    """The held-out report: point estimates, intervals, ranking quality, calibration, the three-way
    operating point, and the per-origin breakdown."""
    intervals = _bootstrap(y, risk, threshold, seed)
    operating = operating_point(y, risk, threshold, review_cap)

    fraction_positive, mean_predicted = calibration_curve(y, risk, n_bins=10, strategy="quantile")
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
        f1=intervals["f1"],
        pr_auc=intervals["pr_auc"],
        roc_auc=float(roc_auc_score(y, risk)),
        brier=float(brier_score_loss(y, risk)),
        false_decline_rate=operating["false_decline_rate"],
        block_rate=operating["block_rate"],
        review_rate=operating["review_rate"],
        review_threshold=operating["review_threshold"],
        reliability=reliability,
        per_origin=per_origin(y, risk, origin, threshold),
    )


def ranking_score(y: np.ndarray, risk: np.ndarray) -> float:
    """Area under the precision-recall curve — the ranking metric the leakage delta is measured in.

    PR-AUC rather than ROC-AUC because abuse is the minority class, and ROC-AUC flatters a model on
    imbalanced data by rewarding it for the easy true negatives it was never going to get wrong.
    """
    return float(average_precision_score(y, risk))
