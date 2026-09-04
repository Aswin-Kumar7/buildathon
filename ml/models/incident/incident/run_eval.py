"""`make eval` for the deployed risk model: train, choose the operating point, evaluate on a held-out
grouped split, measure the leakage delta, ablate, and write the served model, the registry and the
metrics — deterministically from a fixed seed.

Two runs on the same inputs produce byte-identical `metrics.json`, which is what lets CI regenerate
it and diff: a drifted metrics file means the model changed, not that the run was noisy. Every float
is rounded before it is written, so floating-point wobble cannot masquerade as a real change.

The artefacts are written for a reader who was not here: the metrics with their intervals, the
operating point a team would staff, the leakage delta with both split scores side by side, the
per-origin breakdown, the ablation ladder, and a model card that says in words what the numbers mean
and — the load-bearing sentence — that these labels are synthetic, not real-world outcomes.
"""

from __future__ import annotations

import json

import numpy as np

from .canary import canary
from .config import ARTIFACTS_DIR, COST, FEATURES, REVIEW_CAP, SEED, SPLIT, TRAFFIC_FEATURES
from .data import load
from .evaluate import Evaluation, evaluate, operating_point, ranking_score
from .export import VERSION, feature_definition_version, write as write_artifacts
from .ladder import ladder_stability, model_ladder
from .metrics_md import render_metrics_md
from .model import TreeModel, train, train_trees
from .model_card import render_model_card
from .split import grouped_split, group_overlap, naive_split


SERVED_MODEL = "hist-gradient-boosting-temperature"


def _round(value: float, places: int = 6) -> float:
    return round(float(value), places)


def _interval(interval) -> dict[str, float]:
    return {"point": _round(interval.point), "low": _round(interval.low), "high": _round(interval.high)}


def _evaluation_dict(evaluation: Evaluation) -> dict:
    return {
        "n_test": evaluation.n_test,
        "positives": evaluation.positives,
        "threshold": _round(evaluation.threshold),
        "precision": _interval(evaluation.precision),
        "recall": _interval(evaluation.recall),
        "f1": _interval(evaluation.f1),
        "pr_auc": _interval(evaluation.pr_auc),
        "roc_auc": _round(evaluation.roc_auc),
        "brier": _round(evaluation.brier),
        "false_decline_rate": _round(evaluation.false_decline_rate),
        "block_rate": _round(evaluation.block_rate),
        "review_rate": _round(evaluation.review_rate),
        "review_threshold": _round(evaluation.review_threshold),
        "reliability": [
            {"predicted": _round(p["predicted"]), "observed": _round(p["observed"])}
            for p in evaluation.reliability
        ],
        "per_origin": [
            {
                "origin": row["origin"],
                "n": row["n"],
                "positive": row["positive"],
                # The rate's own arithmetic, so "1.000" can be read as the "16 of 16" it actually is,
                # with the interval that count supports rather than the certainty it implies.
                "flagged": row["flagged"],
                "denominator": row["denominator"],
                "interval": {
                    "low": _round(row["interval"]["low"]),
                    "high": _round(row["interval"]["high"]),
                },
                "recall": None if row["recall"] is None else _round(row["recall"]),
                "false_positive_rate": None
                if row["false_positive_rate"] is None
                else _round(row["false_positive_rate"]),
                "mean_risk": _round(row["mean_risk"]),
            }
            for row in evaluation.per_origin
        ],
    }


def _feature_importance(model, x: np.ndarray) -> list[dict]:
    """How much the model actually leans on each feature, normalised to sum to one.

    For the linear model the coefficient *is* the reliance, and no permutation is needed. For the
    served ensemble it is measured the same way the request path explains a single decision: hold one
    feature at its training median, re-score, and take the mean absolute change. Using one definition
    for the published importances and the per-incident contributions means the console and the model
    card cannot tell a reader two different stories about the same feature.
    """
    if isinstance(model, TreeModel):
        base = model.risk(x)
        deltas = []
        for i in range(len(FEATURES)):
            ablated = x.copy()
            ablated[:, i] = model.medians[i]
            deltas.append(float(np.abs(base - model.risk(ablated)).mean()))
        weights = np.array(deltas)
    else:
        weights = np.abs(model.coef[1])
    total = float(weights.sum()) or 1.0
    ranked = sorted(zip(FEATURES, weights / total), key=lambda pair: pair[1], reverse=True)
    return [{"feature": name, "importance": _round(float(value))} for name, value in ranked]


def _learning_curve(x_tr, y_tr, x_val, y_val) -> list[dict]:
    """Val PR-AUC as the training set grows — whether more data would help."""
    curve = []
    rng = np.random.default_rng(SEED)
    order = rng.permutation(len(y_tr))
    for fraction in (0.25, 0.5, 1.0):
        take = max(50, int(len(order) * fraction))
        idx = order[:take]
        model = train_trees(x_tr[idx], y_tr[idx], x_val, y_val, COST)
        val_pr = ranking_score(y_val, model.risk(x_val))
        curve.append({"train_fraction": fraction, "n_train": int(take), "val_pr_auc": _round(val_pr)})
    return curve


def _ablation(x, y, split) -> list[dict]:
    """Test PR-AUC with feature groups removed — proof of what the traffic-context features carry."""
    entity_idx = [i for i, f in enumerate(FEATURES) if f not in TRAFFIC_FEATURES]
    traffic_idx = [i for i, f in enumerate(FEATURES) if f in TRAFFIC_FEATURES]
    ladder = []
    for name, idx in [
        ("all features", list(range(len(FEATURES)))),
        ("entity only (no traffic context)", entity_idx),
        ("traffic context only", traffic_idx),
    ]:
        model = train_trees(x[split.train][:, idx], y[split.train], x[split.validation][:, idx],
                            y[split.validation], COST)
        pr = ranking_score(y[split.test], model.risk(x[split.test][:, idx]))
        ladder.append({"features": name, "n_features": len(idx), "pr_auc": _round(pr)})
    return ladder


def _error_taxonomy(y, risk, threshold, amounts) -> list[dict]:
    """Where the errors fall, by how cheap the entity's attempts were — the small-amount share split
    into terciles. Card testing probes at trivial amounts; a benign biller does not."""
    predicted = risk >= threshold
    terciles = np.quantile(amounts, [1 / 3, 2 / 3])
    buckets = []
    for name, lo, hi in [
        ("low", -np.inf, terciles[0]),
        ("mid", terciles[0], terciles[1]),
        ("high", terciles[1], np.inf),
    ]:
        mask = (amounts >= lo) & (amounts < hi)
        yb, pb = y[mask], predicted[mask]
        buckets.append(
            {
                "amount_band": name,
                "n": int(mask.sum()),
                "false_positive": int(np.sum(pb & (yb == 0))),
                "false_negative": int(np.sum(~pb & (yb == 1))),
            }
        )
    return buckets


def run(write: bool = True) -> dict:
    data = load()
    split = grouped_split(data.groups, SPLIT.test_fraction, SPLIT.validation_fraction)

    model = train_trees(data.x[split.train], data.y[split.train], data.x[split.validation],
                        data.y[split.validation], COST)

    # The served review threshold: the review-cap band applied on validation, so the request path
    # routes to a person at the same bar the reported operating point was measured against.
    val_op = operating_point(data.y[split.validation], model.risk(data.x[split.validation]),
                             model.threshold, REVIEW_CAP)
    review_threshold = val_op["review_threshold"]

    test_risk = model.risk(data.x[split.test])
    honest = evaluate(data.y[split.test], test_risk, data.origin[split.test], model.threshold, SEED)

    # The leakage delta: the same model on a careless row-wise split that ignores the grouping.
    naive = naive_split(len(data.y), SPLIT.test_fraction, SPLIT.validation_fraction)
    naive_model = train(data.x[naive.train], data.y[naive.train], data.x[naive.validation],
                        data.y[naive.validation], COST)
    naive_pr = ranking_score(data.y[naive.test], naive_model.risk(data.x[naive.test]))
    honest_pr = honest.pr_auc.point

    # The no-skill floor: the PR-AUC a ranker with no information reaches, which is the positive
    # prevalence. The model earns only the distance above this.
    no_skill = float(data.y[split.test].mean())

    real = data.real_label_count
    metrics = {
        "provenance": {
            "data_source": "synthetic-cardtesting" if real == 0 else "synthetic+merchant",
            "model_backend": SERVED_MODEL,
            "real_label_count": real,
            "data_note": (
                "Synthetic scenario corpus, not real-world labels. Every row is an entity from a "
                "seeded scenario the project authored; the label is the scenario's ground truth, not "
                "a confirmed chargeback. Scores measure the deployed model on a held-out grouped "
                "split of this corpus. The path to real labels is the merchant's own confirmed "
                "incidents — see the retraining design."
                if real == 0
                else (
                    f"Synthetic scenario corpus plus {real} confirmed merchant labels (real outcomes "
                    "from incidents an analyst confirmed or a chargeback settled). The synthetic rows "
                    "are the cold start; the merchant rows are the real signal, and as they accumulate "
                    "the score comes to describe the model on the merchant's own traffic."
                )
            ),
            "seed": SEED,
            "n_rows": int(len(data.y)),
            "n_groups": int(len(set(data.groups.tolist()))),
            "positive_rate": _round(float(data.y.mean())),
        },
        "honest": {"model": SERVED_MODEL, "review_cap": _round(REVIEW_CAP), **_evaluation_dict(honest)},
        "baseline_no_skill": {"pr_auc": _round(no_skill)},
        "leakage": {
            "honest_pr_auc": _round(honest_pr),
            "naive_pr_auc": _round(naive_pr),
            "delta": _round(naive_pr - honest_pr),
            "honest_group_overlap": group_overlap(data.groups, split.train, split.test),
            "naive_group_overlap": group_overlap(data.groups, naive.train, naive.test),
        },
        "cost": {
            "false_negative_paise": COST.false_negative_paise,
            "false_positive_paise": COST.false_positive_paise,
        },
        "feature_importance": _feature_importance(model, data.x[split.test]),
        "learning_curve": _learning_curve(data.x[split.train], data.y[split.train],
                                           data.x[split.validation], data.y[split.validation]),
        "ablation_ladder": _ablation(data.x, data.y, split),
        # Whether the served model class was the right choice, measured rather than argued, and
        # whether the answer survives being asked of five different groupings of the same corpus.
        "model_ladder": model_ladder(data.x, data.y, split, COST),
        "model_ladder_stability": ladder_stability(
            data.x, data.y, data.groups, COST, SPLIT.test_fraction, SPLIT.validation_fraction
        ),
        # Whether this corpus is hard enough for any of the above to mean anything.
        "canary": canary(
            data.x[split.validation], data.y[split.validation],
            data.x[split.test], data.y[split.test], honest_pr, COST,
        ),
        "error_taxonomy": _error_taxonomy(data.y[split.test], test_risk, model.threshold,
                                          data.amounts[split.test]),
        "split_integrity": {
            "train_test_group_overlap": group_overlap(data.groups, split.train, split.test),
            "n_train": int(len(split.train)),
            "n_test": int(len(split.test)),
        },
    }

    if write:
        registry = write_artifacts(model, review_threshold, metrics, data.training_hash)
        ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        (ARTIFACTS_DIR / "metrics.json").write_text(
            json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        (ARTIFACTS_DIR / "model_card.md").write_text(
            render_model_card(metrics, registry), encoding="utf-8"
        )
        (ARTIFACTS_DIR / "METRICS.md").write_text(render_metrics_md(metrics), encoding="utf-8")
    return metrics


if __name__ == "__main__":
    result = run()
    h = result["honest"]
    leak = result["leakage"]
    print(
        f"eval — PR-AUC={h['pr_auc']['point']} precision={h['precision']['point']} "
        f"recall={h['recall']['point']} f1={h['f1']['point']} threshold={h['threshold']} "
        f"leakage_delta={leak['delta']} group_overlap={result['split_integrity']['train_test_group_overlap']}"
    )
