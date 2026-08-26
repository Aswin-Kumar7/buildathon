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
