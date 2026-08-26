"""Exports the served model, the registry entry, and — best effort — an ONNX graph.

The API serves the model from `model.json`: the scaler, the temperature-folded linear weights, the
class order and the abstain threshold — everything needed to reproduce the model's probabilities as
a few dot products, with no native runtime. That JSON *is* the interchange format the request path
uses; the ONNX file is the portable artefact for anything that speaks ONNX.

ONNX export is attempted, not assumed. The toolchain (`skl2onnx`) conflicts with the numpy this
environment pins for the rest of the ML work, so the export is wrapped and its absence recorded
rather than allowed to sink the run. A linear model's ONNX graph computes exactly what `model.json`
already encodes, so nothing that matters is lost when it is skipped.
"""

from __future__ import annotations

import hashlib
import json

import numpy as np

from .config import ABSTAIN_BELOW, ARTIFACTS_DIR, CLASSES, FEATURES
from .model import LinearModel


def feature_definition_version() -> str:
    digest = hashlib.sha256(",".join(FEATURES).encode()).hexdigest()[:12]
    return f"fdv-{digest}"


def model_json(model: LinearModel) -> dict:
    return {
        "features": FEATURES,
        "classes": CLASSES,
        "abstainBelow": ABSTAIN_BELOW,
        "temperature": round(model.temperature, 6),
        "scalerMean": [round(float(v), 8) for v in model.scaler_mean],
        "scalerStd": [round(float(v), 8) for v in model.scaler_std],
        # coef[c][f], already temperature-folded, so the API applies it directly.
        "coef": [[round(float(v), 8) for v in row] for row in model.coef],
        "intercept": [round(float(v), 8) for v in model.intercept],
    }


def try_export_onnx(model: LinearModel, path) -> bool:
    """Returns True if an ONNX graph was written, False if the toolchain was unavailable.

    Gated behind INCIDENT_EXPORT_ONNX because the converter (skl2onnx) requires a numpy this
    environment does not pin, and against the pinned one it does not merely raise — it *segfaults*,
    which no try/except can catch. So the default is to skip it and record the absence; a reviewer
    on a compatible toolchain opts in with the environment variable. A linear model's ONNX graph
    computes exactly what model.json already encodes, so the request path loses nothing.
    """
    import os

    if os.environ.get("INCIDENT_EXPORT_ONNX") != "1":
        return False

    try:
        from skl2onnx import convert_sklearn  # noqa: F401
        from skl2onnx.common.data_types import FloatTensorType
        from sklearn.linear_model import LogisticRegression

        # Rebuild an equivalent sklearn estimator from the linear weights so the standard converter
        # can serialise it. The scaling is folded in by exporting on already-standardised inputs.
        estimator = LogisticRegression()
        estimator.classes_ = np.arange(len(CLASSES))
        estimator.coef_ = model.coef
        estimator.intercept_ = model.intercept
        onx = convert_sklearn(
            estimator, initial_types=[("features", FloatTensorType([None, len(FEATURES)]))]
        )
        path.write_bytes(onx.SerializeToString())
        return True
    except Exception:
        return False


def write(model: LinearModel, metrics: dict, training_hash: str) -> dict:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    served = model_json(model)
    (ARTIFACTS_DIR / "model.json").write_text(
        json.dumps(served, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    onnx_written = try_export_onnx(model, ARTIFACTS_DIR / "incident_model.onnx")

    registry = {
        "version": "b1",
        "trainingDataHash": training_hash,
        "featureDefinitionVersion": feature_definition_version(),
        "onnxExported": onnx_written,
        "metricsSnapshot": {
            "accuracy": metrics["accuracy"],
            "macroF1": metrics["macro_f1"],
            "abstainRate": metrics["abstain_rate"],
        },
    }
    (ARTIFACTS_DIR / "registry.json").write_text(
        json.dumps(registry, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return registry
