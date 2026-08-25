"""Regenerates the metrics in memory and fails if they differ from the committed `metrics.json`.

The model's equivalent of the detector's `check:metrics`: proof that the numbers a reader sees on
the page are the numbers this code produces from the fixed seed, not a snapshot someone forgot to
refresh after changing the model. Writes nothing.
"""

from __future__ import annotations

import json
import sys

from .config import ARTIFACTS_DIR
from .run_eval import run


def main() -> int:
    committed_path = ARTIFACTS_DIR / "metrics.json"
    if not committed_path.exists():
        print("check-metrics — artifacts/metrics.json is missing. Run `make eval`.")
        return 1

    committed = committed_path.read_text(encoding="utf-8")
    regenerated = json.dumps(run(write=False), indent=2, sort_keys=True) + "\n"

    if committed != regenerated:
        print(
            "check-metrics FAILED — artifacts/metrics.json no longer matches what the pipeline "
            "produces. The model or the data changed and the metrics were not regenerated. Run "
            "`make eval` and commit the result."
        )
        return 1

    print("check-metrics — metrics.json is current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
