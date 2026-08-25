"""Transaction-risk model: an honest benchmark, not a leaderboard entry.

The value of this package is not the score. It is the *method* — a split that does not let the
model memorise a card and call it prediction, an evaluation on data it never saw, and a leakage
delta that shows exactly how much a careless split would have flattered it. The score is whatever
that honest method produces.
"""

__all__ = ["config", "data", "features", "model", "split", "evaluate"]
