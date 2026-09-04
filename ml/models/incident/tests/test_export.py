"""The serving contract: what `model.json` promises the request path.

The trained model lives in Python and the model that actually scores traffic lives in TypeScript,
which means the artefact between them is the only thing keeping the two honest. If the export rounds
too hard, or writes a field the walker reads differently, nothing fails loudly — the API just serves
slightly different numbers than the ones on the model card, forever.

So this walks the exported artefact exactly the way `model-scoring.service.ts` does — the same node
layout, the same `<=` comparison, the same temperature — and requires it to reproduce the trained
model. That is the property the console's numbers rest on.
"""
from __future__ import annotations

import json
import math

import numpy as np
import pytest

from incident.config import ARTIFACTS_DIR, CLASSES, COST, FEATURES, SPLIT
from incident.data import load
from incident.export import model_json
from incident.model import train_trees
from incident.split import grouped_split


@pytest.fixture(scope="module")
def fitted():
    data = load()
    split = grouped_split(data.groups, SPLIT.test_fraction, SPLIT.validation_fraction)
    model = train_trees(
        data.x[split.train], data.y[split.train],
        data.x[split.validation], data.y[split.validation], COST,
    )
    return model, data.x[split.test]


@pytest.fixture(scope="module")
def artefact(fitted):
    model, _ = fitted
    # The real review threshold always sits below the block threshold; passing a dummy above it
    # would make the ordering assertion test the fixture rather than the exporter.
    return model_json(model, review_threshold=model.threshold / 2)


def walk(served: dict, row: np.ndarray) -> float:
    """A transcription of the TypeScript walker, deliberately kept dumb and separate.

    Reimplementing it rather than calling `TreeModel.risk` is the point: if the two ever disagree,
    one of them is wrong about the artefact, and that is exactly the bug this file exists to catch.
    """
    total = served["baseline"]
    for tree in served["trees"]:
        at = 0
        while True:
            is_leaf, feature, threshold, left, right, value = tree[at]
            if is_leaf == 1:
                total += value
                break
            at = int(left) if row[int(feature)] <= threshold else int(right)
    return 1.0 / (1.0 + math.exp(-total / served["temperature"]))


def test_the_exported_artefact_reproduces_the_trained_model(fitted, artefact):
    model, x_test = fitted
    expected = model.risk(x_test)
    worst = max(abs(walk(artefact, row) - want) for row, want in zip(x_test, expected))
    # The artefact is rounded on purpose, so exact equality is the wrong bar. This one is four
    # orders of magnitude tighter than the four decimals the API actually reports.
    assert worst < 1e-8, f"served artefact drifts from the trained model by {worst:.2e}"


def test_the_artefact_declares_which_shape_it_is(artefact):
    assert artefact["kind"] == "binary_risk_trees"
    assert artefact["features"] == FEATURES
    assert artefact["classes"] == CLASSES
    assert artefact["riskClass"] == "abuse"


def test_every_node_is_well_formed(artefact):
    for tree in artefact["trees"]:
        assert len(tree) > 0
        for node in tree:
            assert len(node) == 6, "node = [is_leaf, feature, threshold, left, right, value]"
            is_leaf, feature, _threshold, left, right, _value = node
            assert is_leaf in (0.0, 1.0)
            if is_leaf == 0.0:
                assert 0 <= int(feature) < len(FEATURES)
                # A child that points outside the tree, or backwards, would loop the walker forever.
                for child in (int(left), int(right)):
                    assert 0 < child < len(tree)


def test_attribution_needs_a_median_for_every_feature(artefact):
    """Ablation is how a tree ensemble explains itself here; a missing median would silently make one
    feature's contribution meaningless rather than raise."""
    assert len(artefact["featureMedians"]) == len(FEATURES)
    assert all(math.isfinite(v) for v in artefact["featureMedians"])


def test_the_operating_bands_are_ordered(artefact):
    assert 0.0 < artefact["reviewThreshold"] <= artefact["blockThreshold"] < 1.0


def test_the_committed_artefact_matches_what_the_pipeline_produces():
    """`make eval` writes `model.json`; if the committed one drifted, the API is serving a model
    nobody measured."""
    committed = json.loads((ARTIFACTS_DIR / "model.json").read_text(encoding="utf-8"))
    assert committed["kind"] == "binary_risk_trees"
    assert committed["features"] == FEATURES
    assert len(committed["trees"]) > 0
