"""`make eval` for Model B: train, evaluate selectively, ablate, harden if it scored too well, and
write the served model, the registry, and the metrics — deterministically from a fixed seed."""

from __future__ import annotations

import json

import numpy as np

from .config import ARTIFACTS_DIR, CLASSES, FEATURES, TRAFFIC_FEATURES
from .data import load
from .evaluate import evaluate, macro_f1
from .export import feature_definition_version, write as write_artifacts
from .hardening import maybe_harden
from .model import train
from .metrics_md import render_metrics_md
from .model_card import render_model_card
from .split import grouped_split, group_overlap


def _ablation(x, y, split) -> list[dict]:
    """Macro-F1 with different feature groups removed — proof of which features carry which class.

    The traffic features are what tell an outage from a distributed attack; drop them and that
    distinction collapses, which is the point of measuring it rather than asserting it.
    """
    entity_idx = [i for i, f in enumerate(FEATURES) if f not in TRAFFIC_FEATURES]
    traffic_idx = [i for i, f in enumerate(FEATURES) if f in TRAFFIC_FEATURES]
    rungs = [
        ("all features", list(range(len(FEATURES)))),
        ("entity only (no traffic context)", entity_idx),
        ("traffic context only", traffic_idx),
    ]
    ladder = []
    for name, idx in rungs:
        model = train(x[split.train][:, idx], y[split.train], x[split.validation][:, idx],
                      y[split.validation])
        f1 = macro_f1(y[split.test], model.proba(x[split.test][:, idx]))
        ladder.append({"features": name, "n_features": len(idx), "macro_f1": round(float(f1), 4)})
    return ladder


def run(write: bool = True) -> dict:
    data = load()
    split = grouped_split(data.groups)

    model = train(data.x[split.train], data.y[split.train], data.x[split.validation],
                  data.y[split.validation])
    test_probs = model.proba(data.x[split.test])
    metrics_eval = evaluate(test_probs, data.y[split.test])

    hardening = maybe_harden(
        data.x[split.train], data.y[split.train], data.x[split.validation], data.y[split.validation],
        data.x[split.test], data.y[split.test], test_probs,
    )
    ablation = _ablation(data.x, data.y, split)

    metrics = {
        "provenance": {
            "n_rows": int(len(data.y)),
            "n_groups": int(len(set(data.groups))),
            "training_data_hash": data.training_hash,
            "feature_definition_version": feature_definition_version(),
            "classes": CLASSES,
            "temperature": round(model.temperature, 4),
        },
        "split_integrity": {
            "train_test_group_overlap": group_overlap(data.groups, split.train, split.test),
            "train_val_group_overlap": group_overlap(data.groups, split.train, split.validation),
            "n_train": int(len(split.train)),
            "n_test": int(len(split.test)),
        },
        "evaluation": metrics_eval,
        "ablation_ladder": ablation,
        "hardening": hardening,
    }

    registry = write_artifacts(model, metrics_eval, data.training_hash) if write else {}
    if write:
        ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        (ARTIFACTS_DIR / "metrics.json").write_text(
            json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        (ARTIFACTS_DIR / "model_card.md").write_text(
            render_model_card(metrics, registry), encoding="utf-8"
        )
        (ARTIFACTS_DIR / "METRICS.md").write_text(
            render_metrics_md(metrics), encoding="utf-8"
        )
    return metrics


if __name__ == "__main__":
    result = run()
    e = result["evaluation"]
    print(
        f"eval — accuracy={e['accuracy']} macro_f1={e['macro_f1']} abstain={e['abstain_rate']} "
        f"hardening_triggered={result['hardening']['triggered']} "
        f"group_overlap={result['split_integrity']['train_test_group_overlap']}"
    )
