"""A synthetic dataset shaped like IEEE-CIS, built to make the leakage delta real.

The competition data cannot be redistributed, so a reviewer running this on a clean clone gets a
stand-in. A stand-in is only worth anything if it reproduces the *problem the method solves* — so
this is not noise with a label column. It is built with the one structure that makes an honest
split matter, and it reproduces the exact mechanism by which a fraud model leaks.

**Fraud is mostly a property of the card.** Each card has a hidden risk — most near zero, a few near
certain — and a transaction's fraud is drawn from its card's risk. So knowing *which card* is
almost the whole answer. `card1` and `addr1` are real features that submissions use, and a model
handed them will happily memorise "card 8143 is fraud" from the training rows and be rewarded for it
on that same card's test rows — **when a careless split leaves that card on both sides.** A split
that keeps whole cards together denies it that, and the model is left with only what generalises.

And what generalises is deliberately weak: the transaction-level features (amount, a couple of `V`
columns, a velocity count) carry only a faint echo of fraud. That is realistic — most of the signal
in card fraud really is the card's history — and it is what forces the honest score down to
something modest while the careless score stays inflated by memorisation. The gap between them is the
leakage delta this whole exercise exists to publish. The generator is a pure function of the seed.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# The columns this reproduces from IEEE-CIS: the two card identifiers real models use, a few
# transaction-level signals, and D1 for reconstructing the card's first-seen day.
FEATURE_COLUMNS = ["card1", "addr1", "TransactionAmt", "V1", "V2", "V3", "C1", "C2"]


def synthesize(n_uids: int = 1200, seed: int = 0) -> pd.DataFrame:
    """Builds a transaction table with the IEEE-CIS columns this pipeline reads.

    Returns rows sorted by `TransactionDT`, exactly as the real file arrives, so the split code is
    exercised on the same shape it will see in production.
    """
    rng = np.random.default_rng(seed)
    rows: list[dict[str, object]] = []
    transaction_id = 1_000_000

    for _ in range(n_uids):
        # card1 is drawn independently of risk, so it carries no signal that *generalises* — its
        # only value to a model is memorising this specific card, which is exactly the leak.
        card1 = int(rng.integers(1000, 18000))
        addr1 = int(rng.integers(100, 500))

        # The card's hidden risk: most cards clean, a minority almost entirely fraudulent. Fraud
        # being a property of the card is what makes memorising the card so rewarding.
        high_risk = rng.random() < 0.15
        risk = 0.9 if high_risk else 0.02

        count = int(rng.integers(6, 26))
        first_dt = float(rng.integers(0, 180 * 86_400))
        first_day = first_dt // 86_400
        dt = first_dt

        for _position in range(count):
            dt += float(rng.integers(3_600, 4 * 86_400))
            # D1 in IEEE-CIS is an *integer* count of days since the card's first transaction —
            # day(this) minus day(first) — not a continuous elapsed time. Emitting it as fractional
            # days broke the very reconstruction it exists to support: `floor(dt/day) - D1` only
            # lands on one first-day per card when D1 is defined this way, and with a fraction it
            # scattered each card across dozens of them. This matches the real column.
            d1_days = int(dt // 86_400 - first_day)
            fraud = int(rng.random() < risk)

            # A faint, generalisable echo: fraud nudges these, but with enough noise that they are
            # nowhere near sufficient on their own. This is the only signal the honest model gets.
            echo = 0.95 if fraud else 0.0
            rows.append(
                {
                    "TransactionID": transaction_id,
                    "TransactionDT": dt,
                    "card1": card1,
                    "addr1": addr1,
                    "D1": d1_days,
                    "TransactionAmt": float(abs(rng.normal(70 + echo * 25, 45))),
                    "V1": float(rng.normal(echo, 1.0)),
                    "V2": float(rng.normal(echo * 0.8, 1.0)),
                    "V3": float(rng.normal(0, 1.0)),
                    "C1": float(abs(rng.normal(1 + echo, 1.0))),
                    "C2": float(rng.poisson(1 + echo)),
                    "isFraud": fraud,
                }
            )
            transaction_id += 1

    frame = pd.DataFrame(rows).sort_values("TransactionDT").reset_index(drop=True)
    return frame
