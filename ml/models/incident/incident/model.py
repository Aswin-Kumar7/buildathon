"""A multinomial logistic model, temperature-scaled so it is calibrated *and* still linear.

Linear on purpose. The served model runs in the request path, and a linear multinomial model is a
handful of dot products the API evaluates in TypeScript with no native runtime — the same numbers an
ONNX graph of this model would produce. Its per-feature contributions are exact (coefficient times
the standardised value), which is what the "why flagged" panel shows.

Calibration is temperature scaling: divide the logits by a single scalar T fit on validation to
minimise negative log-likelihood. Unlike isotonic per-class calibration it preserves the linear
form — folding 1/T into the weights — so the model stays something the API can evaluate directly
while its probabilities are made to mean what they say.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize_scalar
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from .config import SEED


@dataclass
class LinearModel:
    scaler_mean: np.ndarray
    scaler_std: np.ndarray
    coef: np.ndarray  # (n_classes, n_features), already divided by temperature
    intercept: np.ndarray  # (n_classes,)
    temperature: float

    def logits(self, x: np.ndarray) -> np.ndarray:
        z = (x - self.scaler_mean) / self.scaler_std
        return z @ self.coef.T + self.intercept

    def proba(self, x: np.ndarray) -> np.ndarray:
        logits = self.logits(x)
        logits = logits - logits.max(axis=1, keepdims=True)
        exp = np.exp(logits)
        return exp / exp.sum(axis=1, keepdims=True)


def _fit_temperature(logits: np.ndarray, y: np.ndarray) -> float:
    """The scalar that, dividing the logits, minimises validation NLL. Clamped to a sane range."""

    def nll(temp: float) -> float:
        scaled = logits / temp
        scaled = scaled - scaled.max(axis=1, keepdims=True)
        log_prob = scaled - np.log(np.exp(scaled).sum(axis=1, keepdims=True))
        return float(-log_prob[np.arange(len(y)), y].mean())

    result = minimize_scalar(nll, bounds=(0.25, 10.0), method="bounded")
    return float(result.x)


def train(x_train: np.ndarray, y_train: np.ndarray, x_val: np.ndarray,
          y_val: np.ndarray) -> LinearModel:
    scaler = StandardScaler().fit(x_train)
    std = scaler.scale_.copy()
    std[std == 0] = 1.0

    base = LogisticRegression(
        max_iter=2000, class_weight="balanced", C=1.0, random_state=SEED
    )
    base.fit((x_train - scaler.mean_) / std, y_train)

    raw_val_logits = ((x_val - scaler.mean_) / std) @ base.coef_.T + base.intercept_
    temperature = _fit_temperature(raw_val_logits, y_val)

    # Fold the temperature into the weights, so the served model is a single linear map.
    return LinearModel(
        scaler_mean=scaler.mean_,
        scaler_std=std,
        coef=base.coef_ / temperature,
        intercept=base.intercept_ / temperature,
        temperature=temperature,
    )
