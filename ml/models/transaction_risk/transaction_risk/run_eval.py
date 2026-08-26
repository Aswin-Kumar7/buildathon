"""`make eval`: the whole benchmark, from data to artefacts, as a pure function of the seed.

Two runs on the same inputs produce byte-identical `metrics.json`, which is what lets CI regenerate
it and diff — a drifted metrics file then means the model changed, not that the run was noisy. Every
float is rounded before it is written, so the last bit of floating-point wobble cannot masquerade as
a real change.

The artefacts are written for a reader who was not here: the metrics with their intervals, the
leakage delta with both split scores side by side, the feature importances, a learning curve, an
error taxonomy, and a model card that says in words what the numbers mean and what they do not.
"""

from __future__ import annotations

import json

import numpy as np

from . import data as data_module
from . import features as features_module
from .config import ARTIFACTS_DIR, COST, REVIEW_CAP, SEED, SPLIT
from sklearn.inspection import permutation_importance

from .evaluate import Evaluation, evaluate, ranking_score
from .model import train_boosted, train_pipeline
from .split import honest_split, naive_split, reconstruct_uid, uid_overlap
from .model_card import render_model_card


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
        "pr_auc": _interval(evaluation.pr_auc),
        "roc_auc": _round(evaluation.roc_auc),
        "brier": _round(evaluation.brier),
        "false_decline_rate": _round(evaluation.false_decline_rate),
        "block_rate": _round(evaluation.block_rate),
        "review_rate": _round(evaluation.review_rate),
        "review_threshold": _round(evaluation.review_threshold),
        "reliability": [
            {"predicted": _round(point["predicted"]), "observed": _round(point["observed"])}
            for point in evaluation.reliability
        ],
    }


def _learning_curve(x_tr, y_tr, x_val, y_val) -> list[dict[str, float]]:
    """Val PR-AUC as the training set grows — the shape that says whether more data would help."""
    curve = []
    rng = np.random.default_rng(SEED)
    order = rng.permutation(len(y_tr))
    for fraction in (0.25, 0.5, 1.0):
        take = max(50, int(len(order) * fraction))
        idx = order[:take]
        model, _ = train_boosted(x_tr[idx], y_tr[idx])
        val_pr = ranking_score(y_val, model.predict_proba(x_val)[:, 1])
        curve.append({"train_fraction": fraction, "n_train": int(take), "val_pr_auc": _round(val_pr)})
    return curve


def _error_taxonomy(y, probs, threshold, amounts) -> list[dict]:
    """Where the errors fall, by transaction-amount tercile — the start of knowing *why* it is wrong."""
    predicted = probs >= threshold
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


def run(write: bool = True, force_synthetic: bool = False) -> dict:
    dataset = data_module.load(seed=SEED, force_synthetic=force_synthetic)
    frame = dataset.frame
    uid = reconstruct_uid(frame)

    # --- the honest split: whole cards, ordered by time, with a delay gap ---
    honest = honest_split(frame, uid, SPLIT)
    train_fm, means, stds = features_module.build(frame.iloc[honest.train])
    val_fm, _, _ = features_module.build(frame.iloc[honest.validation], means, stds)
    test_fm, _, _ = features_module.build(frame.iloc[honest.test], means, stds)

    model = train_pipeline(train_fm.x, train_fm.y, val_fm.x, val_fm.y, COST)
    test_probs = model.proba(test_fm.x)
    honest_eval = evaluate(test_fm.y, test_probs, model.threshold, SEED)

    # A logistic baseline on the same split — the number the boosted model has to beat to justify
    # its opacity.
    baseline = train_pipeline(train_fm.x, train_fm.y, val_fm.x, val_fm.y, COST, kind="logistic")
    baseline_pr = ranking_score(test_fm.y, baseline.proba(test_fm.x))

    # --- the leakage delta: the same pipeline on a careless random split ---
    naive = naive_split(frame, SPLIT, SEED)
    n_train_fm, n_means, n_stds = features_module.build(frame.iloc[naive.train])
    n_val_fm, _, _ = features_module.build(frame.iloc[naive.validation], n_means, n_stds)
    n_test_fm, _, _ = features_module.build(frame.iloc[naive.test], n_means, n_stds)
    naive_model = train_pipeline(n_train_fm.x, n_train_fm.y, n_val_fm.x, n_val_fm.y, COST)
    naive_pr = ranking_score(n_test_fm.y, naive_model.proba(n_test_fm.x))

    honest_pr = honest_eval.pr_auc.point

    # Permutation importance on the calibrated model, over the validation split: how much PR-AUC is
    # lost when each feature is shuffled. Backend-agnostic — it asks the model, not the library —
    # and a truer measure of what the model relies on than a split-count from inside the trees.
    perm = permutation_importance(
        model.calibrated, val_fm.x, val_fm.y, scoring="average_precision",
        n_repeats=5, random_state=SEED, n_jobs=1,
    )
    importances = sorted(
        zip(train_fm.columns, perm.importances_mean), key=lambda pair: pair[1], reverse=True
    )

    metrics = {
        "provenance": {
            "data_source": dataset.source,
            "model_backend": model.backend,
            "data_note": dataset.note,
            "seed": SEED,
            "n_rows": int(len(frame)),
            "n_uids": int(uid.nunique()),
            "fraud_rate": _round(float(frame["isFraud"].mean())),
        },
        "honest": {"model": model.backend, "review_cap": _round(REVIEW_CAP), **_evaluation_dict(honest_eval)},
        "baseline_logistic": {"pr_auc": _round(baseline_pr)},
        "leakage": {
            "honest_pr_auc": _round(honest_pr),
            "naive_pr_auc": _round(naive_pr),
            "delta": _round(naive_pr - honest_pr),
            "honest_uid_overlap": uid_overlap(uid, honest.train, honest.test),
            "naive_uid_overlap": uid_overlap(uid, naive.train, naive.test),
            "dropped_to_gap": honest.dropped_to_gap,
        },
        "cost": {
            "false_negative_paise": COST.false_negative_paise,
            "false_positive_paise": COST.false_positive_paise,
        },
        "feature_importance": [
            {"feature": name, "importance": _round(float(value))} for name, value in importances
        ],
        "learning_curve": _learning_curve(train_fm.x, train_fm.y, val_fm.x, val_fm.y),
        "error_taxonomy": _error_taxonomy(
            test_fm.y, test_probs, model.threshold,
            frame.iloc[honest.test]["TransactionAmt"].astype(float).to_numpy(),
        ),
    }

    if write:
        ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        target = ARTIFACTS_DIR / "metrics.json"
        serialized = json.dumps(metrics, indent=2, sort_keys=True) + "\n"

        # Clobber guard: never overwrite a committed *real* (IEEE-CIS) metrics file with synthetic
        # ones. On a clean clone the real data is absent, so a bare `make eval` produces the stand-in
        # — which must not silently replace the published real result. It goes to a side file instead,
        # and the real metrics.json is left exactly as committed.
        if dataset.source == "synthetic" and target.exists():
            existing = json.loads(target.read_text(encoding="utf-8"))
            if existing.get("provenance", {}).get("data_source") == "ieee-cis":
                (ARTIFACTS_DIR / "metrics.synthetic.json").write_text(serialized, encoding="utf-8")
                print(
                    "The committed metrics.json is from real IEEE-CIS; not overwriting it with "
                    "synthetic numbers. Wrote metrics.synthetic.json instead. Place "
                    "train_transaction.csv in the data directory to regenerate the real metrics."
                )
                return metrics

        target.write_text(serialized, encoding="utf-8")
        (ARTIFACTS_DIR / "model_card.md").write_text(render_model_card(metrics), encoding="utf-8")
    return metrics


if __name__ == "__main__":
    result = run()
    leakage = result["leakage"]
    print(
        f"eval — source={result['provenance']['data_source']} "
        f"honest PR-AUC={leakage['honest_pr_auc']} naive PR-AUC={leakage['naive_pr_auc']} "
        f"leakage delta={leakage['delta']}"
    )
