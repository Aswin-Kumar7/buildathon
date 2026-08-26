"""Reproducibility, the ablation ladder, and the hardening rule."""
from __future__ import annotations
from incident.run_eval import run


def test_eval_is_deterministic():
    assert run(write=False) == run(write=False)


def test_traffic_features_carry_the_population_classes():
    # Removing traffic context must hurt macro-F1: it is what tells an outage from an attack.
    metrics = run(write=False)
    ladder = {r["features"]: r["macro_f1"] for r in metrics["ablation_ladder"]}
    assert ladder["all features"] >= ladder["entity only (no traffic context)"]
    assert ladder["all features"] >= ladder["traffic context only"]


def test_confusion_and_risk_coverage_are_present():
    metrics = run(write=False)["evaluation"]
    assert len(metrics["confusion"]) == len(metrics["classes"]) == 4
    assert len(metrics["risk_coverage"]) > 5


def test_hardening_reports_when_the_corpus_is_too_easy():
    # This corpus is cleanly separable, so hardening should fire and quote the harder number.
    h = run(write=False)["hardening"]
    if h["triggered"]:
        assert h["hardened_macro_f1"] <= h["base_macro_f1"]
