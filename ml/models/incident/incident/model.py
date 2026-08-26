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
