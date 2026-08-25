"""Loading the data — the real competition file if it is present, a synthetic stand-in if not.

Which one was used is never left implicit. Every artefact this pipeline writes records the source,
because a precision figure means something entirely different on held-out competition data than on
a generator built to demonstrate a method, and a reader must never have to guess which they are
looking at.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .config import DATA_DIR
from .synthesize import synthesize

# The columns the pipeline actually uses. The real file has 434; reading only these keeps the
# loader honest about what the model is allowed to see and makes the synthetic and real paths
# line up on exactly the same shape.
USED_COLUMNS = [
    "TransactionID",
    "TransactionDT",
    "card1",
    "addr1",
    "D1",
    "TransactionAmt",
    "V1",
    "V2",
    "V3",
    "C1",
    "C2",
    "isFraud",
]


@dataclass(frozen=True)
class Dataset:
    frame: pd.DataFrame
    source: str  # "ieee-cis" or "synthetic"
    note: str


def load(seed: int) -> Dataset:
    """The real data if a reviewer has placed it, otherwise a deterministic synthetic table.

    The real file is looked for at `data/train_transaction.csv` — the name the competition ships.
    It is never committed (see `download_data.py` and the README), so its absence is the normal
    case on a clean clone, not an error.
    """
    real = DATA_DIR / "train_transaction.csv"
    if real.exists():
        frame = _read_real(real)
        return Dataset(
            frame=frame,
            source="ieee-cis",
            note=(
                "IEEE-CIS train_transaction.csv, the real competition data. Scores here are on a "
                "held-out split of labels this project did not author."
            ),
        )

    frame = synthesize(seed=seed)
    return Dataset(
        frame=frame,
        source="synthetic",
        note=(
            "Synthetic stand-in — the competition data cannot be redistributed. It is built to "
            "reproduce the one structure the method exists to handle (fraud clustered by card "
            "over time), so the leakage delta is real; the absolute scores are not a claim about "
            "IEEE-CIS. Place train_transaction.csv in the data directory to run on the real thing."
        ),
    )


def _read_real(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path, usecols=lambda c: c in USED_COLUMNS)
    # The real file uses NaN liberally; the features module decides how each column is filled, so
    # here we only guarantee the columns exist and the order is stable.
    for column in USED_COLUMNS:
        if column not in frame.columns:
            frame[column] = pd.NA
    return frame[USED_COLUMNS].sort_values("TransactionDT").reset_index(drop=True)
