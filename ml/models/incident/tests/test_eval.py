"""Reproducibility, the ablation ladder, the operating point, the leakage delta, and the one claim
that must never slip: the labels are synthetic."""
from __future__ import annotations
import pytest
from incident.run_eval import run


@pytest.fixture(scope="module")
def metrics():
    return run(write=False)


def test_eval_is_deterministic():
    # The whole point of a seeded pipeline: two runs are byte-identical, so a drift means the model
    # changed, not that the run was noisy.
    assert run(write=False) == run(write=False)


def test_traffic_features_help_ranking(metrics):
    ladder = {r["features"]: r["pr_auc"] for r in metrics["ablation_ladder"]}
    assert ladder["all features"] >= ladder["entity only (no traffic context)"] - 1e-9
    assert ladder["all features"] >= ladder["traffic context only"] - 1e-9


def test_headline_numbers_carry_intervals_and_an_operating_point(metrics):
    h = metrics["honest"]
    for key in ("precision", "recall", "f1", "pr_auc"):
        i = h[key]
        assert 0.0 <= i["low"] <= i["point"] <= i["high"] <= 1.0
    assert 0.0 < h["threshold"] < 1.0
    assert 0.0 <= h["false_decline_rate"] <= 1.0
    assert len(h["reliability"]) > 0


def test_per_origin_breakdown_is_present(metrics):
    per_origin = metrics["honest"]["per_origin"]
    # Every family and composition that reached the test split gets a row, with the right score kind.
    assert len(per_origin) > 5
    for row in per_origin:
        if row["positive"]:
            assert row["recall"] is not None
        else:
            assert row["false_positive_rate"] is not None


def test_leakage_delta_is_reported_and_the_grouped_split_is_clean(metrics):
    leak = metrics["leakage"]
    assert leak["honest_group_overlap"] == 0
    # Small on a single-generator synthetic corpus, and honestly so — but present and bounded.
    assert -0.5 < leak["delta"] < 0.5


def test_labels_are_declared_synthetic(metrics):
    p = metrics["provenance"]
    assert p["data_source"] == "synthetic-cardtesting"
    assert "synthetic" in p["data_note"].lower()
    assert "not real" in p["data_note"].lower()
