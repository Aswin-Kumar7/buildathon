"""Loads the training table the TS exporter produced from the corpus."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import CLASSES, DATA_DIR, FEATURES


@dataclass
class Dataset:
    x: np.ndarray
    y: np.ndarray  # class index into CLASSES
    groups: np.ndarray  # scenario seed group; a group never straddles the split
    training_hash: str


def load() -> Dataset:
    path = DATA_DIR / "training.csv"
    frame = pd.read_csv(path)
    class_index = {name: i for i, name in enumerate(CLASSES)}

    return Dataset(
        x=frame[FEATURES].to_numpy(dtype=float),
        y=frame["label"].map(class_index).to_numpy(dtype=int),
        groups=frame["group"].to_numpy(),
        # The exact bytes the model was trained on, pinned in the registry so a metrics snapshot is
        # traceable to its data.
        training_hash="sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()[:16],
    )
