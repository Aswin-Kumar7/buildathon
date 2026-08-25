"""The model, and the two decisions that turn a probability into a defensible action.

The order is deliberate: a logistic regression first, because a baseline nobody can beat is a
baseline worth having, and a gradient-boosted model second, kept only if it earns its added
opacity against that baseline. Then two things a raw classifier does not give you:

- **Calibration.** A boosted model's outputs rank well and are not probabilities — 0.9 does not mean
  nine times in ten. A cost-based threshold is meaningless on numbers that are not probabilities, so
  the model is calibrated on the validation split before any threshold is chosen.

- **A threshold chosen on cost, not on an abstract metric.** The operating point is the one that
  minimises expected cost given the declared price of a miss and a false block — frozen on
  validation and never tuned on the test set, which sees exactly one threshold: the one already
  decided.

The boosted model is LightGBM where it is available, and sklearn's histogram gradient boosting
where it is not. They are the same algorithm — histogram-based gradient-boosted trees — and which
one ran is recorded on every artefact rather than assumed. LightGBM is the intended backend; the
fallback exists so a reviewer on a machine where LightGBM's native build is broken still gets a real
run rather than a stack trace.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression

from .config import CostModel, SEED


@dataclass
class TrainedModel:
    calibrated: CalibratedClassifierCV
    threshold: float
    kind: str
    backend: str

    def proba(self, x: np.ndarray) -> np.ndarray:
        return self.calibrated.predict_proba(x)[:, 1]


def train_logistic(x: np.ndarray, y: np.ndarray) -> LogisticRegression:
    """The baseline. Balanced class weights, because fraud is rare and an unweighted fit would do
    well by simply never predicting it."""
    model = LogisticRegression(max_iter=1000, class_weight="balanced", random_state=SEED)
    model.fit(x, y)
    return model


def _train_lightgbm(x: np.ndarray, y: np.ndarray):
    from lightgbm import LGBMClassifier

    model = LGBMClassifier(
        n_estimators=300,
        learning_rate=0.05,
        num_leaves=127,
        max_depth=-1,
        subsample=0.8,
        colsample_bytree=0.8,
        class_weight="balanced",
        random_state=SEED,
        n_jobs=1,
        verbosity=-1,
        deterministic=True,
        force_row_wise=True,
    )
    model.fit(np.ascontiguousarray(x, dtype=np.float64), np.ascontiguousarray(y, dtype=np.int32))
    return model


def _train_histgb(x: np.ndarray, y: np.ndarray) -> HistGradientBoostingClassifier:
    """The fallback: the same histogram GBDT, from sklearn. Depth and leaves matched to the
    LightGBM settings so the two backends are as close to the same model as two libraries allow."""
    model = HistGradientBoostingClassifier(
        max_iter=400,
        learning_rate=0.05,
        max_leaf_nodes=127,
        max_depth=None,
        l2_regularization=1.0,
        class_weight="balanced",
        random_state=SEED,
    )
    model.fit(x, y)
    return model


def train_boosted(x: np.ndarray, y: np.ndarray) -> tuple[object, str]:
    """LightGBM if its native build runs here, sklearn histogram boosting otherwise."""
    try:
        return _train_lightgbm(x, y), "lightgbm"
    except Exception:
        # A broken native LightGBM must not sink the whole run — the fallback is the same algorithm
        # from a library that is already known to work in this environment.
        return _train_histgb(x, y), "sklearn-histgb"


def calibrate(estimator, x_val: np.ndarray, y_val: np.ndarray) -> CalibratedClassifierCV:
    """Wraps a fitted model and calibrates its probabilities on the validation split.

    Isotonic, which is non-parametric and does not assume the miscalibration has a particular
    shape — appropriate when the model is a boosted ensemble whose distortion is not a neat sigmoid.
    """
    calibrated = CalibratedClassifierCV(estimator, method="isotonic", cv="prefit")
    calibrated.fit(x_val, y_val)
    return calibrated


def choose_threshold(probs: np.ndarray, y: np.ndarray, cost: CostModel) -> float:
    """The probability above which acting is cheaper than not, on the validation split.

    Swept over the observed probabilities rather than a fixed grid, so the chosen point sits
    exactly where a real decision boundary would fall. Ties break towards the higher threshold —
    fewer blocks — because a false block is a real shopper turned away and the tie should not cost
    them the benefit of the doubt.
    """
    candidates = np.unique(np.concatenate([[0.0], probs, [1.0]]))
    best_threshold = 0.5
    best_cost = np.inf

    for threshold in candidates:
        predicted = probs >= threshold
        false_positive = int(np.sum(predicted & (y == 0)))
        false_negative = int(np.sum(~predicted & (y == 1)))
        expected = (
            false_positive * cost.false_positive_paise + false_negative * cost.false_negative_paise
        )
        if expected < best_cost or (expected == best_cost and threshold > best_threshold):
            best_cost = expected
            best_threshold = float(threshold)

    return best_threshold


def train_pipeline(
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_val: np.ndarray,
    y_val: np.ndarray,
    cost: CostModel,
    kind: str = "boosted",
) -> TrainedModel:
    """Fits the chosen model, calibrates it on validation, and freezes the cost-optimal threshold."""
    if kind == "logistic":
        estimator, backend = train_logistic(x_train, y_train), "logistic"
    else:
        estimator, backend = train_boosted(x_train, y_train)

    calibrated = calibrate(estimator, x_val, y_val)
    val_probs = calibrated.predict_proba(x_val)[:, 1]
    threshold = choose_threshold(val_probs, y_val, cost)
    return TrainedModel(calibrated=calibrated, threshold=threshold, kind=kind, backend=backend)
