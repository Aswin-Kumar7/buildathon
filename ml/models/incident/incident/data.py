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
    real_label_count: int  # rows that came from confirmed merchant incidents, not the synthetic corpus


def load() -> Dataset:
    """The synthetic corpus, plus any confirmed merchant labels that have been exported alongside it.

    `merchant_labels.csv` is the retraining seam made real: rows the exporter wrote from incidents an
    analyst confirmed (or a chargeback settled), in the exact same feature columns. When it is present
    the model trains on real outcomes as well as the synthetic cold-start, and the provenance says so.
    When it is absent — the ordinary case today — the corpus stands alone. Either way the same code
    path runs, so the day real labels exist nothing has to change to use them.
    """
    path = DATA_DIR / "training.csv"
    frame = pd.read_csv(path)
    digest = hashlib.sha256(path.read_bytes())

    real_label_count = 0
    merchant_path = DATA_DIR / "merchant_labels.csv"
    if merchant_path.exists():
        merchant = pd.read_csv(merchant_path)
        real_label_count = int(len(merchant))
        frame = pd.concat([frame, merchant], ignore_index=True)
        digest.update(merchant_path.read_bytes())

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
        training_hash="sha256:" + digest.hexdigest()[:16],
        real_label_count=real_label_count,
    )
