"""Loads the training table the TS exporter produced from the corpus."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import DATA_DIR, FEATURES, LABEL


@dataclass
class Dataset:
    x: np.ndarray
    y: np.ndarray  # 1 = abuse, 0 = benign
    groups: np.ndarray  # scenario instance; a group never straddles the split
    origin: np.ndarray  # which family or composition produced the row, for the error taxonomy
    amounts: np.ndarray  # not a feature — kept for the amount-band error taxonomy only
    training_hash: str


def load() -> Dataset:
    path = DATA_DIR / "training.csv"
    frame = pd.read_csv(path)

    # `small_amount_share` is a rate in [0, 1]; there is no raw amount column, so the amount-band
    # taxonomy uses it as a proxy for how cheap the entity's attempts were — a real axis on which
    # card-testing (tiny amounts) and dunning (real amounts) differ.
    amounts = frame["small_amount_share"].to_numpy(dtype=float)

    return Dataset(
        x=frame[FEATURES].to_numpy(dtype=float),
        y=frame[LABEL].to_numpy(dtype=int),
        groups=frame["group"].to_numpy(),
        origin=frame["origin"].to_numpy(),
        amounts=amounts,
        # The exact bytes the model was trained on, pinned in the registry so a metrics snapshot is
        # traceable to its data.
        training_hash="sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()[:16],
    )
