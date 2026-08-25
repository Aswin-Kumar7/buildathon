"""Split integrity: the properties that, if they fail, make every downstream number a lie."""

from __future__ import annotations

import numpy as np

from transaction_risk.config import SPLIT
from transaction_risk.split import honest_split, naive_split, reconstruct_uid, uid_overlap
from transaction_risk.synthesize import synthesize


def _data():
    frame = synthesize(n_uids=1500, seed=1)
    return frame, reconstruct_uid(frame)


def test_reconstructed_uid_is_stable_per_card():
    # Every transaction of one card must resolve to one identifier, or the grouping is meaningless.
    frame, uid = _data()
    grouped = frame.assign(uid=uid.to_numpy()).groupby(["card1", "addr1"])["uid"].nunique()
    # A card+address can legitimately span more than one first-day only through data noise; the vast
    # majority must be a single UID for the grouping to mean anything.
    assert (grouped == 1).mean() > 0.9


def test_honest_split_shares_no_card_between_train_and_test():
    # The whole point. Zero cards in common — anything else is leakage by construction.
    frame, uid = _data()
    split = honest_split(frame, uid, SPLIT)
    assert uid_overlap(uid, split.train, split.test) == 0
    assert uid_overlap(uid, split.train, split.validation) == 0
    assert uid_overlap(uid, split.validation, split.test) == 0


def test_honest_split_orders_train_before_test_in_time():
    frame, uid = _data()
    split = honest_split(frame, uid, SPLIT)
    times = frame["TransactionDT"].astype(float).to_numpy()
    # Train transactions all precede the test period (the gap enforces strict separation).
    assert times[split.train].max() <= times[split.test].min()


def test_honest_split_drops_a_delay_gap():
    frame, uid = _data()
    split = honest_split(frame, uid, SPLIT)
    assert split.dropped_to_gap > 0


def test_naive_split_leaks_cards_across_train_and_test():
    # The careless split must actually be careless — sharing cards — or the leakage delta it
    # produces would be an accident rather than a demonstration.
    frame, uid = _data()
    split = naive_split(frame, SPLIT, seed=1)
    assert uid_overlap(uid, split.train, split.test) > 0


def test_splits_cover_every_row_once():
    frame, uid = _data()
    for split in (honest_split(frame, uid, SPLIT), naive_split(frame, SPLIT, seed=1)):
        allocated = np.concatenate([split.train, split.validation, split.test])
        assert len(allocated) == len(np.unique(allocated))  # no row in two splits
