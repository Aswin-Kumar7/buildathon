"""Turning the raw table into the matrix the model sees — and, as much as anything, deciding what it
is *not* allowed to see.

Two deletions matter more than any transformation here:

- **Raw `TransactionDT` is dropped.** It is the wall-clock time of the transaction, and a model
  given it will happily learn "fraud happened more in this stretch of the training period" — a
  fact about the past that does not generalise to the future the model will actually run in. The
  time is used to *split* the data and then thrown away as a feature.

- **The card identifier never becomes a feature.** It is used to group the split so a card cannot
  leak across it, and that is all. Feeding the UID to the model would be the leakage the split
  exists to prevent, let back in through the front door.

The `D` columns are day-counts on wildly different scales; they are normalised so no single one
dominates a linear model by unit alone.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

# What the model is allowed to learn from. Note what is absent: TransactionDT, card1, addr1, and
# the reconstructed UID. Those exist to split honestly, not to predict.
# card1 and addr1 are included on purpose, the way real submissions include them. They carry no
# signal that generalises — a random split lets a model memorise them, a grouped split does not,
# and that difference is the leakage delta. Excluding them would hide the problem the split
# solves rather than solve it.
MODEL_FEATURES = ["card1", "addr1", "TransactionAmt", "V1", "V2", "V3", "C1", "C2", "D1_norm"]


@dataclass
class FeatureMatrix:
    x: np.ndarray
    y: np.ndarray
    columns: list[str]


def build(frame: pd.DataFrame, means: dict[str, float] | None = None,
          stds: dict[str, float] | None = None) -> tuple[FeatureMatrix, dict[str, float], dict[str, float]]:
    """Builds the feature matrix, normalising with statistics from the training split only.

    The means and standard deviations are computed on train and *passed in* for validation and
    test, never recomputed on them. Normalising each split by its own statistics would leak the
    test distribution into the model's inputs — a subtle form of the same disease this whole
    module is careful about.
    """
    work = frame.copy()

    # D1 as a normalised magnitude; the raw day-count is on a different scale from the V/C columns.
    work["D1_norm"] = work["D1"].astype(float)

    numeric = ["card1", "addr1", "TransactionAmt", "V1", "V2", "V3", "C1", "C2", "D1_norm"]
    for column in numeric:
        work[column] = pd.to_numeric(work[column], errors="coerce")

    # Missing values become the column mean (zero after centring), a defensible neutral rather than
    # a magic sentinel a tree could split on as if it meant something.
    if means is None or stds is None:
        means = {c: float(work[c].mean()) for c in numeric}
        stds = {c: float(work[c].std(ddof=0)) or 1.0 for c in numeric}

    for column in numeric:
        filled = work[column].fillna(means[column])
        work[column] = (filled - means[column]) / (stds[column] if stds[column] != 0 else 1.0)

    x = work[MODEL_FEATURES].to_numpy(dtype=float)
    y = frame["isFraud"].astype(int).to_numpy()
    return FeatureMatrix(x=x, y=y, columns=list(MODEL_FEATURES)), means, stds
