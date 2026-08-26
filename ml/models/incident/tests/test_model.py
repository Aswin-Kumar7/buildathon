"""The served model.json reproduces the trained model within tolerance — the parity guarantee the
request path rests on, standing in for the ONNX golden-set check."""
from __future__ import annotations
import numpy as np
from incident.data import load
from incident.export import model_json
from incident.model import train
from incident.split import grouped_split


def _softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def test_exported_json_reproduces_the_model():
    data = load()
    split = grouped_split(data.groups)
    model = train(data.x[split.train], data.y[split.train], data.x[split.validation], data.y[split.validation])
    served = model_json(model)

    x = data.x[split.test]
    mean = np.array(served["scalerMean"])
    std = np.array(served["scalerStd"])
    coef = np.array(served["coef"])
    intercept = np.array(served["intercept"])
    reproduced = _softmax(((x - mean) / std) @ coef.T + intercept)

    assert np.max(np.abs(reproduced - model.proba(x))) < 1e-6


def test_abstains_when_unsure():
    # The reject option must actually engage. A dominant, well-separated class makes the plain
    # mean of the data look confidently healthy — being sure there is correct, not a failure — so
    # that is the wrong probe. A genuinely ambiguous entity is one pulled equally toward *every*
    # class: the centroid of the per-class centroids, equidistant from all four. On a point like
    # that the model should decline rather than force a call, and its top probability should fall
    # below the abstain bar the operating point uses.
    from incident.config import ABSTAIN_BELOW, CLASSES

    data = load()
    split = grouped_split(data.groups)
    model = train(data.x[split.train], data.y[split.train], data.x[split.validation], data.y[split.validation])

    x_train, y_train = data.x[split.train], data.y[split.train]
    centroids = np.stack([x_train[y_train == c].mean(axis=0) for c in range(len(CLASSES))])
    ambiguous = centroids.mean(axis=0, keepdims=True)

    top = model.proba(ambiguous).max()
    assert top < ABSTAIN_BELOW  # equidistant from every class → the model abstains rather than guesses
    # And the contrast: on a class-typical point it is decisive. Confidence tracks ambiguity, which
    # is the whole justification for having an abstain at all.
    assert model.proba(centroids[:1]).max() > ABSTAIN_BELOW
