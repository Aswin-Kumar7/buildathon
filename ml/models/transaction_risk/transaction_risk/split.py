"""Dividing the data honestly, and dividing it carelessly on purpose so the difference can be shown.

Two things make a fraud split honest, and both are easy to get wrong in a way that silently
inflates every number downstream:

1. **Group on the card, not the transaction.** Fraud recurs on the same card, so a split that puts
   some of a card's transactions in train and the rest in test lets the model learn the card
   rather than the fraud, and rewards it for a recognition it cannot repeat on a card it has never
   seen. Whole cards go to one side.

2. **Respect time, with a gap.** The test period must come after the train period, because a model
   deployed on Tuesday cannot have trained on Wednesday. And a label is not known the instant a
   transaction happens — a chargeback lands days later — so a band of the most recent train
   transactions is dropped, since their labels would not yet exist at training time.

The card identity is not a column. It is reconstructed the way the competition's community found
it: `card1`, `addr1`, and the card's first-transaction day, which `D1` (days since that first
transaction) lets us recover from the transaction time.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import SplitConfig

SECONDS_PER_DAY = 86_400.0


def reconstruct_uid(frame: pd.DataFrame) -> pd.Series:
    """A stable per-card identifier: `card1_addr1_firstDay`.

    `D1` is days since the card's first transaction, so `floor(TransactionDT / day) - D1` is the
    day that card first appeared — a value that is the same for every transaction of the card and
    different between cards. Rows where the pieces are missing get a unique identifier of their
    own, so a pile of NaNs is never collapsed into one giant false "card".
    """
    day = np.floor(frame["TransactionDT"].astype(float) / SECONDS_PER_DAY)
    first_day = day - frame["D1"].astype(float)

    uid = (
        frame["card1"].astype("string").fillna("na")
        + "_"
        + frame["addr1"].astype("string").fillna("na")
        + "_"
        + first_day.round().astype("Int64").astype("string").fillna("na")
    )

    # Anything with a missing piece is not a real card and must not merge with other unknowns.
    incomplete = frame[["card1", "addr1", "D1"]].isna().any(axis=1) | first_day.isna()
    uid = uid.astype("object")
    uid[incomplete.to_numpy()] = [f"unknown_{i}" for i in np.where(incomplete.to_numpy())[0]]
    return pd.Series(uid, index=frame.index, name="uid")


@dataclass(frozen=True)
class Split:
    train: np.ndarray
    validation: np.ndarray
    test: np.ndarray
    kind: str  # "grouped-time" or "naive-random"
    dropped_to_gap: int


def honest_split(frame: pd.DataFrame, uid: pd.Series, cfg: SplitConfig) -> Split:
    """Whole cards, ordered by when they first appeared, with a delay gap before the test period."""
    times = frame["TransactionDT"].astype(float).to_numpy()

    # Each card is placed by when it first appeared, so the ordering is by time and the grouping is
    # by card at once. Sorting the cards this way makes "earlier cards train, later cards test".
    first_time = pd.Series(times, index=frame.index).groupby(uid.to_numpy()).min()
    ordered_uids = first_time.sort_values().index.to_numpy()

    n = len(ordered_uids)
    test_start = int(round(n * (1 - cfg.test_fraction)))
    val_start = int(round(test_start * (1 - cfg.validation_fraction)))

    train_uids = set(ordered_uids[:val_start])
    val_uids = set(ordered_uids[val_start:test_start])
    test_uids = set(ordered_uids[test_start:])

    uid_values = uid.to_numpy()
    train_mask = np.array([u in train_uids for u in uid_values])
    val_mask = np.array([u in val_uids for u in uid_values])
    test_mask = np.array([u in test_uids for u in uid_values])

    # The delay gap: the earliest test transaction marks the boundary, and train transactions in
    # the band just before it are dropped, because at training time their labels would not be in.
    boundary = times[test_mask].min() if test_mask.any() else times.max()
    gap_seconds = cfg.delay_gap_days * SECONDS_PER_DAY
    in_gap = train_mask & (times > boundary - gap_seconds)
    train_mask = train_mask & ~in_gap

    return Split(
        train=np.where(train_mask)[0],
        validation=np.where(val_mask)[0],
        test=np.where(test_mask)[0],
        kind="grouped-time",
        dropped_to_gap=int(in_gap.sum()),
    )


def naive_split(frame: pd.DataFrame, cfg: SplitConfig, seed: int) -> Split:
    """The wrong way, on purpose: shuffle rows and cut, ignoring the card and ignoring time.

    This is what produces the leakage delta. It is not a strawman — it is the default a
    `train_test_split(shuffle=True)` gives, which is exactly how a fraud model gets quietly
    over-reported.
    """
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(frame))

    n = len(order)
    test_start = int(round(n * (1 - cfg.test_fraction)))
    val_start = int(round(test_start * (1 - cfg.validation_fraction)))

    return Split(
        train=np.sort(order[:val_start]),
        validation=np.sort(order[val_start:test_start]),
        test=np.sort(order[test_start:]),
        kind="naive-random",
        dropped_to_gap=0,
    )


def uid_overlap(uid: pd.Series, left: np.ndarray, right: np.ndarray) -> int:
    """How many cards appear in both index sets — the thing an honest split drives to zero."""
    values = uid.to_numpy()
    return len(set(values[left]) & set(values[right]))
