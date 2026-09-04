"""The three integrity checks a reader should be able to run rather than take on trust: that the
per-origin rates carry the uncertainty their sample sizes actually support, that the corpus is not
separable by one column, and that the served model class was compared against alternatives rather
than assumed.

These are deliberately written to be capable of failing. A canary that cannot go off, or a ladder
asserted to be won by the incumbent, would be decoration.
"""
from __future__ import annotations

import pytest

from incident.canary import TRIVIAL_MARGIN
from incident.evaluate import wilson
from incident.run_eval import run


@pytest.fixture(scope="module")
def metrics():
    return run(write=False)


# ---- Wilson intervals ---------------------------------------------------------------------------


def test_wilson_never_claims_certainty_from_a_small_sample():
    # The failure this exists to prevent: k == n printed as 1.000 and read as certainty. The normal
    # approximation collapses to zero width here; Wilson must not.
    interval = wilson(16, 16)
    assert interval["high"] == 1.0
    assert interval["low"] < 0.85, "16/16 must not claim more than it can support"

    # More evidence, same rate, a tighter floor — the interval has to respond to sample size.
    assert wilson(160, 160)["low"] > wilson(16, 16)["low"]


def test_wilson_stays_inside_the_unit_interval_at_both_extremes():
    for successes, trials in ((0, 21), (21, 21), (0, 1), (1, 1), (3, 7)):
        i = wilson(successes, trials)
        assert 0.0 <= i["low"] <= i["high"] <= 1.0


def test_wilson_handles_an_empty_denominator():
    assert wilson(0, 0) == {"low": 0.0, "high": 0.0}


def test_every_per_origin_row_reports_the_count_behind_its_rate(metrics):
    for row in metrics["honest"]["per_origin"]:
        assert row["denominator"] > 0, row["origin"]
        assert 0 <= row["flagged"] <= row["denominator"], row["origin"]

        rate = row["recall"] if row["positive"] else row["false_positive_rate"]
        assert rate is not None, row["origin"]
        # The interval must actually bracket the point estimate it describes.
        assert row["interval"]["low"] - 1e-9 <= rate <= row["interval"]["high"] + 1e-9, row["origin"]


def test_a_perfect_per_origin_rate_still_carries_doubt(metrics):
    """Any origin scoring exactly 1.000 or 0.000 must publish an interval that admits it could be
    otherwise, unless the sample is genuinely large enough to have narrowed it."""
    for row in metrics["honest"]["per_origin"]:
        rate = row["recall"] if row["positive"] else row["false_positive_rate"]
        if rate in (0.0, 1.0) and row["denominator"] < 100:
            width = row["interval"]["high"] - row["interval"]["low"]
            assert width > 0.02, f"{row['origin']} claims {rate} on {row['denominator']} rows"


# ---- the leakage canary -------------------------------------------------------------------------


def test_the_corpus_is_not_separable_by_a_single_feature(metrics):
    c = metrics["canary"]
    assert c["lift_over_one_rule"] >= TRIVIAL_MARGIN, (
        f"one rule on {c['strongest_feature']} reaches PR-AUC {c['one_rule_baseline']['pr_auc']} "
        f"against the model's {c['model_pr_auc']} — the corpus is giving the answer away"
    )
    assert c["trivially_separable"] is False


def test_the_canary_scores_every_feature_and_ranks_by_distance_from_chance(metrics):
    rows = metrics["canary"]["single_feature_auc"]
    assert len(rows) == len(set(r["feature"] for r in rows))
    separations = [r["separation"] for r in rows]
    assert separations == sorted(separations, reverse=True)
    assert metrics["canary"]["strongest_feature"] == rows[0]["feature"]


def test_the_one_rule_baseline_beats_chance_but_loses_to_the_model(metrics):
    """If the hand-written rule were useless the comparison would be flattering; if it matched the
    model the corpus would be trivial. It should land clearly between the two."""
    c = metrics["canary"]
    no_skill = metrics["baseline_no_skill"]["pr_auc"]
    assert no_skill < c["one_rule_baseline"]["pr_auc"] < c["model_pr_auc"]


# ---- the model ladder ---------------------------------------------------------------------------


def test_the_ladder_compares_the_served_model_against_other_classes(metrics):
    ladder = metrics["model_ladder"]
    served = [r for r in ladder if r["served"]]
    assert len(served) == 1, "exactly one row is the deployed model"
    assert served[0]["model"] == metrics["honest"]["model"]
    assert len(ladder) >= 3, "a ladder of one alternative is not a comparison"


def test_the_ladder_reports_deltas_against_the_served_model(metrics):
    ladder = metrics["model_ladder"]
    served = next(r for r in ladder if r["served"])
    for row in ladder:
        if row["served"]:
            continue
        assert row["pr_auc_delta"] == pytest.approx(row["pr_auc"] - served["pr_auc"], abs=1e-6)
        assert row["cost_delta_paise"] == row["cost_paise"] - served["cost_paise"]


def test_the_ladder_result_is_reported_with_its_spread_not_one_split(metrics):
    s = metrics["model_ladder_stability"]
    assert s["n_seeds"] >= 3
    assert len(s["seeds"]) == s["n_seeds"] == len(set(s["seeds"]))
    assert 0 <= s["served_wins"] <= s["n_seeds"]
    assert s["compared_with"] != metrics["honest"]["model"], "compared against itself"
    d = s["pr_auc_delta"]
    assert d["min"] <= d["mean"] <= d["max"]
    assert d["sd"] >= 0.0


def test_the_served_model_row_matches_the_headline_evaluation(metrics):
    """The ladder retrains the served model rather than reusing the fitted one, so a mismatch here
    means the two paths have drifted apart and one of them is lying."""
    served = next(r for r in metrics["model_ladder"] if r["served"])
    h = metrics["honest"]
    assert served["pr_auc"] == pytest.approx(h["pr_auc"]["point"], abs=1e-6)
    assert served["precision"] == pytest.approx(h["precision"]["point"], abs=1e-6)
    assert served["recall"] == pytest.approx(h["recall"]["point"], abs=1e-6)
    assert served["threshold"] == pytest.approx(h["threshold"], abs=1e-6)
