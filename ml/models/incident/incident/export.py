"""Exports the served model and its registry entry.

The API serves the model from `model.json`: the scaler, the temperature-folded linear weights, the
two class names, and the two operating thresholds — everything needed to reproduce P(abuse) as a few
dot products, with no native runtime. The thresholds travel *with* the weights so the request path
scores at exactly the operating point the cost analysis chose: below `reviewThreshold` the risk is
too low to act on, above `blockThreshold` it is containment-eligible (still gated by the rules), and
between them it is a case for a person.
"""

from __future__ import annotations

import hashlib
import json

from .config import ARTIFACTS_DIR, CLASSES, FEATURES
from .model import LinearModel

VERSION = "r1"


def feature_definition_version() -> str:
    digest = hashlib.sha256(",".join(FEATURES).encode()).hexdigest()[:12]
    return f"fdv-{digest}"


def model_json(model: LinearModel, review_threshold: float) -> dict:
    return {
        "kind": "binary_risk",
        "features": FEATURES,
        "classes": CLASSES,
        "riskClass": "abuse",
        "reviewThreshold": round(review_threshold, 6),
        "blockThreshold": round(model.threshold, 6),
        "temperature": round(model.temperature, 6),
        "scalerMean": [round(float(v), 8) for v in model.scaler_mean],
        "scalerStd": [round(float(v), 8) for v in model.scaler_std],
        # coef[c][f], already temperature-folded; row 0 (benign) is pinned to zero, so the API's
        # softmax over the two class logits yields sigmoid(abuse_logit) = P(abuse) directly.
        "coef": [[round(float(v), 8) for v in row] for row in model.coef],
        "intercept": [round(float(v), 8) for v in model.intercept],
    }


def write(model: LinearModel, review_threshold: float, metrics: dict, training_hash: str) -> dict:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    served = model_json(model, review_threshold)
    (ARTIFACTS_DIR / "model.json").write_text(
        json.dumps(served, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    honest = metrics["honest"]
    registry = {
        "version": VERSION,
        "trainingDataHash": training_hash,
        "featureDefinitionVersion": feature_definition_version(),
        "onnxExported": False,
        "metricsSnapshot": {
            "prAuc": honest["pr_auc"]["point"],
            "precision": honest["precision"]["point"],
            "recall": honest["recall"]["point"],
        },
    }
    (ARTIFACTS_DIR / "registry.json").write_text(
        json.dumps(registry, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return registry
