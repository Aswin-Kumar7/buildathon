"""The corpus-hardening rule: if the model scores too well, don't report it — make it harder first.

A model that aces the corpus has probably learned the corpus, not the problem. Above a stated macro-
F1 the corpus is deemed too easy, and a hardening round runs before the number stands: the features
are perturbed with noise the size of their own spread, the model is retrained and re-scored, and the
harder number becomes the one reported, flagged as such. The alternative — publishing the flattering
score — is exactly the self-congratulation this project is built to avoid.
"""

from __future__ import annotations

import numpy as np

from .config import HARDENING_MACRO_F1, SEED
from .evaluate import evaluate, macro_f1
from .model import train


def maybe_harden(x_train, y_train, x_val, y_val, x_test, y_test, base_probs) -> dict:
    base_f1 = macro_f1(y_test, base_probs)
    if base_f1 <= HARDENING_MACRO_F1:
        return {"triggered": False, "base_macro_f1": round(float(base_f1), 4)}

    # Too easy. Add Gaussian noise scaled to each feature's own standard deviation, retrain, re-score.
    rng = np.random.default_rng(SEED)
    scale = x_train.std(axis=0)
    noise = lambda a: a + rng.normal(0, 1, size=a.shape) * scale * 0.5
    hardened = train(noise(x_train), y_train, noise(x_val), y_val)
    hardened_eval = evaluate(hardened.proba(noise(x_test)), y_test)

    return {
        "triggered": True,
        "base_macro_f1": round(float(base_f1), 4),
        "hardened_macro_f1": hardened_eval["macro_f1"],
        "note": (
            "The corpus scored above the hardening threshold, so a round of feature noise was added "
            "and the model re-evaluated. The hardened number is the honest one to quote."
        ),
    }
