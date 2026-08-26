"""Fixed constants: the feature order, the label, the seed, the costs, the split. The served model
and this trainer must agree on every one of them, so they live in exactly one place.

This is the *one* deployed model: a binary card-testing / abuse risk score, P(abuse), trained and
evaluated on the synthetic corpus and served in the request path. There is no separate benchmark
model any more — the number the model page reports is this model's, on a held-out split of the same
corpus it was trained on. The IEEE-CIS work remains only as supporting research, not the product's
headline.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ARTIFACTS_DIR = ROOT / "artifacts"

# The one seed. Referenced everywhere randomness enters — the model, the bootstrap, the learning
# curve — so the whole pipeline is a pure function of it.
SEED = 20260826

# The feature definition, in the order the TS exporter writes and the API recomputes. Changing this
# list changes the feature-definition version the registry pins, and the model must be retrained.
FEATURES = [
    "log_attempts",
    "failure_rate",
    "approval_rate",
    "infra_share",
    "cards_per_attempt",
    "small_amount_share",
    "burstiness",
    "recovery_rate",
    "top_session_failure_share",
    "log_failing_sessions",
]

# Which features are about the population rather than the entity. The ablation ladder removes these
# to show what they carry: without them an outage's failures and a masked attack look alike.
TRAFFIC_FEATURES = ["infra_share", "top_session_failure_share", "log_failing_sessions"]

# The label column in training.csv, and the two class names in the order the served weights index.
# `abuse` is the positive class — the risk score is P(abuse), the second class.
LABEL = "is_abuse"
CLASSES = ["benign", "abuse"]


@dataclass(frozen=True)
class CostModel:
    """What a mistake costs, in the currency the policy uses.

    The block threshold is not chosen to maximise an abstract metric; it minimises expected cost
    given these numbers, declared here so the choice can be argued with rather than reverse-engineered.
    A missed card-testing episode runs up chargebacks and fees across many cards; a wrongly-flagged
    benign entity costs an analyst's time and, at worst, a reversible review — never an automatic
    block, because the model can only ever route to a person, not contain on its own.
    """

    false_negative_paise: int = 500_000
    false_positive_paise: int = 80_000


COST = CostModel()

# The analyst review budget: the share of entities a human can look at. A cost-optimal block
# threshold is not the whole story — the riskiest entities *below* it are the ones worth a person's
# time, and there are only so many hours in a day. The operating point reports a three-way split
# (observe / review / contain-eligible) where the review band takes the riskiest non-blocked traffic
# up to this cap. Making the capacity explicit is what stops a model that "reviews everything" from
# looking free.
REVIEW_CAP = 0.03


@dataclass(frozen=True)
class SplitConfig:
    """How the corpus is divided. Grouped on the scenario instance, so a seed the model trained on
    never appears in the test set — the score measures generalisation, not memory of a seed's quirks.
    """

    test_fraction: float = 0.25
    validation_fraction: float = 0.2


SPLIT = SplitConfig()
