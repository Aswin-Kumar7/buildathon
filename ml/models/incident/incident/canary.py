"""The leakage canary: is this corpus actually hard, or does it give the answer away?

A model scoring 0.94 on data the project generated itself proves nothing on its own. The obvious
failure is a corpus whose classes are separable by one column — a generator that made attacks louder
than anything benign, so any model trained on it looks excellent and none of it transfers. Reporting
a headline score without testing for that is the single easiest way to be honestly wrong.

So this measures the floor rather than the ceiling. It scores every raw feature alone, finds the
strongest one, and fits the dumbest possible model on it: one threshold, chosen on validation by the
same cost sweep the real operating point uses. The distance between that one-rule baseline and the
trained model is what the model actually earns. If a single threshold already matched it, the
corpus would be a giveaway and every number built on it would be worth less.

The verdict is a stated bar, not a vibe: a corpus is flagged trivially separable when one feature
alone reaches within `TRIVIAL_MARGIN` PR-AUC of the trained model. Publishing the bar means the
check can fail in public later, when the generator changes and nobody remembers this file.
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

from .config import FEATURES, CostModel

# How close a single-feature rule may come to the trained model before the corpus is judged to be
# giving the answer away. 0.15 PR-AUC is a wide bar deliberately: it should catch a broken generator,
# not fire on a corpus that merely has one informative column, which every real one does.
TRIVIAL_MARGIN = 0.15


def _one_rule(
    x_val: np.ndarray, y_val: np.ndarray, x_test: np.ndarray, y_test: np.ndarray,
    index: int, direction: float, cost: CostModel,
) -> dict:
    """The best single threshold on one feature, chosen on validation by expected cost — the same
    rule a person would write by hand before anyone suggested machine learning."""
    best_threshold, best_cost = None, float("inf")
    for candidate in np.unique(x_val[:, index]):
        predicted = direction * x_val[:, index] >= direction * candidate
        total = (
            int(np.sum(~predicted & (y_val == 1))) * cost.false_negative_paise
            + int(np.sum(predicted & (y_val == 0))) * cost.false_positive_paise
        )
        if total < best_cost:
            best_cost, best_threshold = total, float(candidate)

    predicted = direction * x_test[:, index] >= direction * best_threshold
    true_pos = int(np.sum(predicted & (y_test == 1)))
    false_pos = int(np.sum(predicted & (y_test == 0)))
    false_neg = int(np.sum(~predicted & (y_test == 1)))
    return {
        "feature": FEATURES[index],
        "direction": "above" if direction > 0 else "below",
        "threshold": round(best_threshold, 6),
        "precision": round(true_pos / (true_pos + false_pos) if true_pos + false_pos else 0.0, 6),
        "recall": round(true_pos / (true_pos + false_neg) if true_pos + false_neg else 0.0, 6),
        "pr_auc": round(float(average_precision_score(y_test, direction * x_test[:, index])), 6),
        "cost_paise": false_neg * cost.false_negative_paise + false_pos * cost.false_positive_paise,
    }


def canary(
    x_val: np.ndarray, y_val: np.ndarray, x_test: np.ndarray, y_test: np.ndarray,
    model_pr_auc: float, cost: CostModel,
) -> dict:
    """Single-feature separability, the one-rule baseline, and the verdict against the stated bar."""
    per_feature = []
    for i, name in enumerate(FEATURES):
        auc = float(roc_auc_score(y_test, x_test[:, i]))
        # An AUC below 0.5 is not a useless feature, it is an inverted one: the class is more likely
        # when the value is *low*. Ranking on distance from chance keeps both kinds comparable.
        per_feature.append(
            {"feature": name, "auc": round(auc, 6), "separation": round(abs(auc - 0.5), 6)}
        )
    per_feature.sort(key=lambda row: row["separation"], reverse=True)

    strongest = per_feature[0]
    index = FEATURES.index(strongest["feature"])
    direction = 1.0 if strongest["auc"] >= 0.5 else -1.0
    baseline = _one_rule(x_val, y_val, x_test, y_test, index, direction, cost)

    lift = round(float(model_pr_auc) - baseline["pr_auc"], 6)
    trivially_separable = bool(lift < TRIVIAL_MARGIN)
    return {
        "single_feature_auc": per_feature,
        "strongest_feature": strongest["feature"],
        "strongest_feature_auc": strongest["auc"],
        "one_rule_baseline": baseline,
        "model_pr_auc": round(float(model_pr_auc), 6),
        "lift_over_one_rule": lift,
        "trivial_margin": TRIVIAL_MARGIN,
        "trivially_separable": trivially_separable,
        "verdict": (
            f"One feature alone ({strongest['feature']}) reaches PR-AUC {baseline['pr_auc']}; the "
            f"model reaches {round(float(model_pr_auc), 6)}, a lift of {lift}. "
            + (
                "That is inside the "
                f"{TRIVIAL_MARGIN} margin, so the corpus is close to separable by one column and "
                "these scores should not be read as evidence the model generalises."
                if trivially_separable
                else "The corpus is not separable by any single feature, so the model is earning "
                "its score from the combination rather than from a giveaway column."
            )
        ),
    }
