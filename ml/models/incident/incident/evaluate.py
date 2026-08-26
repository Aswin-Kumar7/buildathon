"""Selective evaluation: how good the model is, and how good it is when allowed to say "not sure".

The reject option is the whole point of an abstain. The risk-coverage curve is the honest picture of
it — as the confidence bar rises the model answers less often (coverage falls) and is right more of
the time it does answer (selective accuracy rises). A single accuracy number hides that trade; this
reports the curve, and the confusion matrix at full coverage so nothing is swept under the abstain.
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import f1_score

from .config import ABSTAIN_BELOW, CLASSES


def confusion(y_true: np.ndarray, y_pred: np.ndarray) -> list[list[int]]:
    n = len(CLASSES)
    matrix = [[0] * n for _ in range(n)]
    for actual, predicted in zip(y_true, y_pred):
        matrix[int(actual)][int(predicted)] += 1
    return matrix


def risk_coverage(probs: np.ndarray, y: np.ndarray) -> list[dict[str, float]]:
    confidence = probs.max(axis=1)
    predicted = probs.argmax(axis=1)
    curve = []
    for threshold in np.linspace(0.0, 0.95, 20):
        covered = confidence >= threshold
        coverage = float(covered.mean())
        accuracy = float((predicted[covered] == y[covered]).mean()) if covered.any() else 1.0
        curve.append(
            {"threshold": round(float(threshold), 4), "coverage": round(coverage, 4),
             "selective_accuracy": round(accuracy, 4)}
        )
    return curve


def macro_f1(y_true: np.ndarray, probs: np.ndarray) -> float:
    return float(f1_score(y_true, probs.argmax(axis=1), average="macro"))


def evaluate(probs: np.ndarray, y: np.ndarray) -> dict:
    predicted = probs.argmax(axis=1)
    confidence = probs.max(axis=1)
    abstained = confidence < ABSTAIN_BELOW

    per_class = {}
    for i, name in enumerate(CLASSES):
        tp = int(np.sum((predicted == i) & (y == i)))
        fp = int(np.sum((predicted == i) & (y != i)))
        fn = int(np.sum((predicted != i) & (y == i)))
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        per_class[name] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "support": int(np.sum(y == i)),
        }

    return {
        "n_test": int(len(y)),
        "accuracy": round(float((predicted == y).mean()), 4),
        "macro_f1": round(macro_f1(y, probs), 4),
        "abstain_rate": round(float(abstained.mean()), 4),
        "abstain_threshold": ABSTAIN_BELOW,
        "per_class": per_class,
        "confusion": confusion(y, predicted),
        "classes": CLASSES,
        "risk_coverage": risk_coverage(probs, y),
    }
