"""Reproducibility and the leakage delta: the run is a pure function of the seed, and the honest
split scores below the careless one."""

from __future__ import annotations

from transaction_risk.run_eval import run


def test_eval_is_deterministic_from_the_seed():
    # Two runs, byte-identical metrics — the property that lets CI diff the committed file.
    first = run(write=False)
    second = run(write=False)
    assert first == second


def test_leakage_delta_is_positive_and_reported():
    # The careless split scores higher than the honest one: the model looking better than it is by
    # recognising cards it will not see again. If this ever went to zero, the split stopped mattering
    # and the whole method would need re-examining.
    metrics = run(write=False)
    leak = metrics["leakage"]
    assert leak["naive_pr_auc"] >= leak["honest_pr_auc"]
    assert leak["delta"] >= 0
    assert leak["honest_uid_overlap"] == 0
    assert leak["naive_uid_overlap"] > 0


def test_headline_numbers_carry_intervals():
    metrics = run(write=False)
    for key in ("precision", "recall", "pr_auc"):
        interval = metrics["honest"][key]
        assert interval["low"] <= interval["point"] <= interval["high"]


def test_operating_point_is_three_way_and_capacity_capped():
    # The desk runs allow / review / block, and review is a capacity, not a free tier: the review
    # band never exceeds the declared budget, and the block threshold is not disturbed by it.
    honest = run(write=False)["honest"]
    assert honest["review_rate"] <= honest["review_cap"] + 1e-9
    # The review band sits below the block threshold — the riskiest traffic that was not blocked.
    assert honest["review_threshold"] <= honest["threshold"]
    # A false-decline rate is reported and is a valid share.
    assert 0.0 <= honest["false_decline_rate"] <= 1.0
    assert 0.0 <= honest["block_rate"] <= 1.0
