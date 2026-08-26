"""Fixed constants: the feature order, the class order, the seed, the thresholds. The served model
and this trainer must agree on every one of them, so they live in exactly one place."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ARTIFACTS_DIR = ROOT / "artifacts"

SEED = 20260826

# The feature definition, in the order the TS exporter writes and the API recomputes. Changing this
# list changes the feature-definition version the registry pins.
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
# to show they are what separate an outage from an attack — a per-entity view cannot.
TRAFFIC_FEATURES = ["infra_share", "top_session_failure_share", "log_failing_sessions"]

# The four decidable classes, in a fixed order so the confusion matrix and the served weights line
# up. Abstain is not here — it is the reject option, exercised at scoring time by confidence.
CLASSES = ["attack", "outage", "retry_storm", "healthy_traffic"]

# Above this test macro-F1, the corpus is deemed too easy: a hardening round runs before the number
# is reported, so a flattering score never stands unchallenged.
HARDENING_MACRO_F1 = 0.97

# The confidence below which the model abstains at its chosen operating point. The risk-coverage
# curve sweeps this; this is where the served model is frozen.
ABSTAIN_BELOW = 0.55
