"""The served model.json reproduces the trained model within tolerance — the parity guarantee the
request path rests on — and the risk score does what a risk score must."""
from __future__ import annotations
import numpy as np
from incident.config import COST
from incident.data import load
from incident.export import model_json
from incident.model import train
from incident.split import grouped_split


def _served_risk(served: dict, x: np.ndarray) -> np.ndarray:
    """P(abuse) as the API computes it: softmax over the two class logits, second class."""
    mean = np.array(served["scalerMean"])
    std = np.array(served["scalerStd"])
    coef = np.array(served["coef"])
    intercept = np.array(served["intercept"])
    logits = ((x - mean) / std) @ coef.T + intercept
    logits = logits - logits.max(axis=1, keepdims=True)
    e = np.exp(logits)
    return (e / e.sum(axis=1, keepdims=True))[:, 1]


def _model():
    data = load()
    split = grouped_split(data.groups)
    model = train(data.x[split.train], data.y[split.train], data.x[split.validation],
                  data.y[split.validation], COST)
    return data, split, model


def test_exported_json_reproduces_the_model():
    data, split, model = _model()
    served = model_json(model, review_threshold=0.3)
    x = data.x[split.test]
    assert np.max(np.abs(_served_risk(served, x) - model.risk(x))) < 1e-6


def test_risk_ranks_abuse_above_benign():
    data, split, model = _model()
    risk = model.risk(data.x[split.test])
    y = data.y[split.test]
    # The property PR-AUC rewards: abuse entities score higher on average than benign ones.
    assert risk[y == 1].mean() > risk[y == 0].mean()
    # The block threshold is a real interior operating point, not a degenerate 0 or 1.
    assert 0.0 < model.threshold < 1.0


def test_threshold_leans_toward_recall_under_the_cost_asymmetry():
    # A missed attack costs far more than a wrongly-flagged benign, so the cost-optimal threshold
    # sits below 0.5: the model is told to lean toward catching. The Bayes-optimal point for a
    # calibrated model is fp / (fp + fn) — well under a half at these costs.
    _, _, model = _model()
    assert model.threshold < 0.5
