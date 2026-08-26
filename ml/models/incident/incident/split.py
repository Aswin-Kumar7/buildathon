"""Partitioning so a scenario seed never appears on both sides.

Each row's group is its scenario instance (family + seed). Grouping the split on it means the model
is tested on seeds it never trained on — the corpus equivalent of the card-grouping in Model A. A
row-wise shuffle would let the model memorise a seed's quirks and be rewarded for it, and the score
would be a measure of memory rather than of generalisation."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.model_selection import GroupShuffleSplit

from .config import SEED


@dataclass
class Split:
    train: np.ndarray
    validation: np.ndarray
    test: np.ndarray


def grouped_split(groups: np.ndarray, test_fraction: float = 0.25,
                  val_fraction: float = 0.2) -> Split:
    idx = np.arange(len(groups))

    outer = GroupShuffleSplit(n_splits=1, test_size=test_fraction, random_state=SEED)
    trainval, test = next(outer.split(idx, groups=groups))

    inner = GroupShuffleSplit(n_splits=1, test_size=val_fraction, random_state=SEED)
    tr, val = next(inner.split(trainval, groups=groups[trainval]))

    return Split(train=trainval[tr], validation=trainval[val], test=test)


def group_overlap(groups: np.ndarray, a: np.ndarray, b: np.ndarray) -> int:
    return len(set(groups[a]) & set(groups[b]))


def naive_split(n: int, test_fraction: float = 0.25, val_fraction: float = 0.2) -> Split:
    """A careless row-wise split that ignores the scenario grouping — for the leakage delta only.

    It lets entities from one scenario instance fall on both sides of the split, so the model can be
    rewarded for recognising a seed it half-remembers. The gap between this score and the grouped
    one is the leakage delta: how much a naive evaluation would have flattered the model. On a corpus
    drawn from a single seeded generator the gap is small — every instance generalises to every other
    — which is itself the honest thing to report, and the reason the dramatic leakage story belongs
    to the real-data IEEE-CIS benchmark, not here.
    """
    rng = np.random.default_rng(SEED)
    idx = rng.permutation(n)
    n_test = int(n * test_fraction)
    n_val = int(n * val_fraction)
    return Split(
        train=idx[n_test + n_val :],
        validation=idx[n_test : n_test + n_val],
        test=idx[:n_test],
    )
