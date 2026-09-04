"""Exports the served model and its registry entry.

`model.json` carries everything the request path needs to reproduce P(abuse) with no native runtime,
and a `kind` that says how to read it:

- `binary_risk` — the temperature-folded linear weights and a scaler. Scoring is a few dot products.
- `binary_risk_trees` — a gradient-boosted ensemble as nested `[is_leaf, feature, threshold, left,
  right, value]` node arrays, plus the per-feature training medians the serving side uses to derive
  exact interventional contributions by re-scoring with one feature held at its median.

Both shapes are supported by the scoring service, so a rollback to the linear model is a matter of
regenerating the artefact rather than shipping code. The thresholds travel *with* the model either
way, so the request path scores at exactly the operating point the cost analysis chose: below
`reviewThreshold` the risk is too low to act on, above `blockThreshold` it is containment-eligible
(still gated by the rules), and between them it is a case for a person.
"""

from __future__ import annotations

import hashlib
import json

from .config import ARTIFACTS_DIR, CLASSES, FEATURES
from .model import LinearModel, TreeModel

VERSION = "r1"


def feature_definition_version() -> str:
    digest = hashlib.sha256(",".join(FEATURES).encode()).hexdigest()[:12]
    return f"fdv-{digest}"


def model_json(model: LinearModel | TreeModel, review_threshold: float) -> dict:
    if isinstance(model, TreeModel):
        return {
            "kind": "binary_risk_trees",
            "features": FEATURES,
            "classes": CLASSES,
            "riskClass": "abuse",
            "reviewThreshold": round(review_threshold, 6),
            "blockThreshold": round(model.threshold, 6),
            "temperature": round(model.temperature, 10),
            "baseline": round(float(model.baseline), 10),
            # Where each feature sits in training. Replacing one value with its median and re-scoring
            # gives that feature's exact contribution to *this* prediction — the tree equivalent of
            # the linear model's coefficient times value.
            "featureMedians": [round(float(v), 8) for v in model.medians],
            # node = [is_leaf, feature, threshold, left, right, value]; x <= threshold goes left.
            "trees": [
                [[round(float(v), 10) for v in node] for node in tree] for tree in model.trees
            ],
        }
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


def write(model: LinearModel | TreeModel, review_threshold: float, metrics: dict,
          training_hash: str) -> dict:
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
