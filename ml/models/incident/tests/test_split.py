"""Split integrity: a scenario seed never straddles the divide."""
from __future__ import annotations
import numpy as np
from incident.data import load
from incident.split import grouped_split, group_overlap


def test_grouped_split_shares_no_scenario_between_train_and_test():
    data = load()
    split = grouped_split(data.groups)
    assert group_overlap(data.groups, split.train, split.test) == 0
    assert group_overlap(data.groups, split.train, split.validation) == 0
    assert group_overlap(data.groups, split.validation, split.test) == 0


def test_splits_are_disjoint_and_cover_the_data():
    data = load()
    split = grouped_split(data.groups)
    allocated = np.concatenate([split.train, split.validation, split.test])
    assert len(allocated) == len(np.unique(allocated)) == len(data.y)
