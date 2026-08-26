"""Every constant the pipeline depends on, in one place, so a run is reproducible from it.

Nothing here is discovered at runtime and nothing is random without a seed. Two runs of `make
eval` on the same inputs must produce byte-identical metrics, and that property starts with there
being no hidden source of variation to begin with.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# The package root, resolved from this file, so paths work wherever the process is started.
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ARTIFACTS_DIR = ROOT / "artifacts"

# The one seed. Referenced everywhere randomness enters — the synthetic generator, the model, the
# bootstrap — so the whole pipeline is a pure function of it.
SEED = 20260826


@dataclass(frozen=True)
class SplitConfig:
    """How the data is divided, and the two rules that make the division honest.

    `group_on_uid` keeps every transaction of one card+address together, so the model cannot
    learn "this card is fraud" from the train split and be rewarded for repeating it on the test
    split. `delay_gap_days` drops the transactions that straddle the train/test time boundary,
    because in production a label is not known the instant a transaction happens — a fraud is
    confirmed days later, and a model that trained on labels it could not yet have had is a model
    measured against a future it will not have.
    """

    test_fraction: float = 0.2
    validation_fraction: float = 0.15
    delay_gap_days: float = 7.0
    group_on_uid: bool = True


@dataclass(frozen=True)
class CostModel:
    """What a mistake costs, in the same currency the policy uses.

    The threshold is not chosen to maximise an abstract metric; it is chosen to minimise expected
    cost given these numbers, and they are declared here so the choice can be argued with rather
    than reverse-engineered from a number.
    """

    # A missed fraud costs the disputed amount and the chargeback fee.
    false_negative_paise: int = 300_000
    # A blocked legitimate shopper costs the basket and some of their future custom.
    false_positive_paise: int = 120_000


SPLIT = SplitConfig()
COST = CostModel()

# The analyst review budget: the share of traffic a human can look at. A cost-optimal block
# threshold is not the whole operating story — the highest-risk transactions that fall *below* it
# are the ones worth a person's time, and there are only so many hours in a day. So the operating
# point reports a three-way split (allow / review / block) where the review band takes the riskiest
# non-blocked traffic up to this cap, and no further. Making the capacity explicit is what stops a
# model that "reviews everything" from looking free.
REVIEW_CAP = 0.01
