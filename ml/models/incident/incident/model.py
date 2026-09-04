"""A binary logistic risk model, temperature-scaled so it is calibrated *and* still linear.

Linear on purpose. The served model runs in the request path, and a linear model is a handful of dot
products the API evaluates in TypeScript with no native runtime. It produces one number — P(abuse),
the card-testing risk score — and its per-feature contributions are exact (coefficient times the
standardised value), which is what the "why flagged" panel shows.

Calibration is temperature scaling: divide the logit by a single scalar T fit on validation to
minimise negative log-likelihood, so the probabilities mean what they say. Folding 1/T into the
weights keeps the model a single linear map. The score is exported as a two-class softmax with the
benign logit pinned at zero, so `softmax([0, z])[1]` is exactly `sigmoid(z)` — the API's existing
dot-product-and-softmax path serves it unchanged, and P(abuse) is simply the second class.

The block threshold is not 0.5. It is the risk at which the expected cost of acting equals the
expected cost of not — chosen on validation from the declared costs, so the operating point is a
decision that can be argued with rather than a default nobody picked.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize_scalar
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from .config import SEED, CostModel


@dataclass
class LinearModel:
    scaler_mean: np.ndarray
    scaler_std: np.ndarray
    coef: np.ndarray  # (2, n_features): row 0 is the pinned benign logit (zeros), row 1 is abuse
    intercept: np.ndarray  # (2,)
    temperature: float
    threshold: float  # the cost-optimal block threshold on P(abuse)

    def _abuse_logit(self, x: np.ndarray) -> np.ndarray:
        z = (x - self.scaler_mean) / self.scaler_std
        return z @ self.coef[1] + self.intercept[1]

    def risk(self, x: np.ndarray) -> np.ndarray:
        """P(abuse) for each row — the served risk score."""
        return 1.0 / (1.0 + np.exp(-self._abuse_logit(x)))


def _fit_temperature(logit: np.ndarray, y: np.ndarray) -> float:
    """The scalar that, dividing the abuse logit, minimises validation NLL. Clamped to a sane range."""

    def nll(temp: float) -> float:
        p = 1.0 / (1.0 + np.exp(-logit / temp))
        p = np.clip(p, 1e-7, 1 - 1e-7)
        return float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())

    result = minimize_scalar(nll, bounds=(0.25, 10.0), method="bounded")
    return float(result.x)


def cost_optimal_threshold(y: np.ndarray, risk: np.ndarray, cost: CostModel) -> float:
    """The risk at which expected cost is lowest, swept over candidate thresholds on validation.

    Below it, a missed abuse (false negative) is the cheaper mistake to risk; above it, a wrongly
    flagged benign (false positive) is. The crossing is where the two expected costs meet, and it is
    where the operating point sits.
    """
    best_t, best_cost = 0.5, float("inf")
    for t in np.linspace(0.05, 0.95, 91):
        predicted = risk >= t
        false_neg = int(np.sum(~predicted & (y == 1)))
        false_pos = int(np.sum(predicted & (y == 0)))
        total = false_neg * cost.false_negative_paise + false_pos * cost.false_positive_paise
        if total < best_cost:
            best_cost, best_t = total, float(t)
    return best_t


def train(
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_val: np.ndarray,
    y_val: np.ndarray,
    cost: CostModel,
) -> LinearModel:
    scaler = StandardScaler().fit(x_train)
    std = scaler.scale_.copy()
    std[std == 0] = 1.0

    base = LogisticRegression(max_iter=2000, C=1.0, random_state=SEED)
    base.fit((x_train - scaler.mean_) / std, y_train)
    w = base.coef_[0]
    b = float(base.intercept_[0])

    val_logit = ((x_val - scaler.mean_) / std) @ w + b
    temperature = _fit_temperature(val_logit, y_val)

    model = LinearModel(
        scaler_mean=scaler.mean_,
        scaler_std=std,
        # Benign logit pinned at zero; the abuse logit carries the temperature-folded weights, so a
        # two-class softmax reproduces sigmoid(abuse_logit) exactly.
        coef=np.vstack([np.zeros_like(w), w / temperature]),
        intercept=np.array([0.0, b / temperature]),
        temperature=temperature,
        threshold=0.5,
    )
    model.threshold = cost_optimal_threshold(y_val, model.risk(x_val), cost)
    return model


@dataclass
class TreeModel:
    """A histogram gradient-boosted ensemble, temperature-scaled, exported as walkable JSON.

    The served model. It replaced the linear one because the ladder said to: on the same grouped
    split and the same cost model a tree ensemble reached PR-AUC 0.991 against 0.940 and halved the
    cost of being wrong, and it did so on every one of five re-splits. Publishing that and then
    serving the loser would have been a strange thing to do.

    What the linear model had that this does not is exact attribution from the coefficients. That is
    recovered a different way — see `contributions` in the scoring service: each feature is replaced
    by its training median and the model re-scored, which is an exact interventional contribution for
    *this* prediction rather than an approximation of one. Eleven walks of a 200-tree ensemble costs
    about 66 microseconds, against a detection latency measured in seconds.

    Nothing about the request path changed. The ensemble serialises to nested arrays of
    `[is_leaf, feature, threshold, left, right, value]`, which TypeScript walks directly — still no
    native runtime, still no ONNX.
    """

    trees: list[list[list[float]]]
    baseline: float
    temperature: float
    threshold: float
    medians: np.ndarray

    def _raw(self, x: np.ndarray) -> np.ndarray:
        """The ensemble's summed log-odds — the same descent the TypeScript serving performs, with
        every row walked through each tree at once so `make eval` stays inside its CI budget."""
        rows = np.arange(len(x))
        total = np.full(len(x), float(self.baseline))
        for tree in self.trees:
            nodes = np.asarray(tree, dtype=float)
            at = np.zeros(len(x), dtype=np.int64)
            # Depth is bounded by the ensemble's own max_leaf_nodes; the cap only stops a malformed
            # tree from spinning, and the assertion below proves every row really did land on a leaf.
            for _ in range(64):
                leaf = nodes[at, 0] == 1.0
                if leaf.all():
                    break
                feature = nodes[at, 1].astype(np.int64)
                go_left = x[rows, feature] <= nodes[at, 2]
                step = np.where(go_left, nodes[at, 3], nodes[at, 4]).astype(np.int64)
                at = np.where(leaf, at, step)
            if not (nodes[at, 0] == 1.0).all():
                raise ValueError("tree walk did not terminate on a leaf")
            total += nodes[at, 5]
        return total

    def risk(self, x: np.ndarray) -> np.ndarray:
        """P(abuse) for each row — the served risk score."""
        return 1.0 / (1.0 + np.exp(-self._raw(x) / self.temperature))


def _flatten(predictor) -> list[list[float]]:
    """One fitted tree as plain nested lists, in the order the TypeScript walker expects."""
    return [
        [
            float(node["is_leaf"]),
            float(node["feature_idx"]),
            float(node["num_threshold"]),
            float(node["left"]),
            float(node["right"]),
            float(node["value"]),
        ]
        for node in predictor.nodes
    ]


def train_trees(
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_val: np.ndarray,
    y_val: np.ndarray,
    cost: CostModel,
) -> TreeModel:
    """Fit the served ensemble, calibrate it, and choose its operating point — the same three steps
    in the same order as the linear model, so the two are comparable on the ladder."""
    if not np.isfinite(x_train).all() or not np.isfinite(x_val).all():
        raise ValueError("features contain NaN or inf; the exported walker has no missing-value path")

    base = HistGradientBoostingClassifier(
        random_state=SEED, max_iter=200, learning_rate=0.05,
        max_leaf_nodes=15, early_stopping=False,
    )
    base.fit(x_train, y_train)

    # Calibrate on validation, exactly as the linear model does. Temperature is a monotone transform,
    # so ranking (and therefore PR-AUC) is untouched; what it fixes is what the number *means*.
    val_raw = base.decision_function(x_val).ravel()
    temperature = _fit_temperature(val_raw, y_val)

    model = TreeModel(
        trees=[_flatten(p[0]) for p in base._predictors],
        baseline=float(np.ravel(base._baseline_prediction)[0]),
        temperature=temperature,
        threshold=0.5,
        medians=np.median(x_train, axis=0),
    )
    model.threshold = cost_optimal_threshold(y_val, model.risk(x_val), cost)
    return model
