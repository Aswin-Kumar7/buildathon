"""Verifies the committed `metrics.json` is what the pipeline produces — honestly, whether or not the
real data is present.

The model's equivalent of the detector's `check:metrics`. Three cases, because the published metrics
may be from the real IEEE-CIS data, which cannot be committed (Kaggle competition rules, §7.B):

- **Committed metrics are real, and the data is here** → regenerate and diff. The published numbers
  must be exactly what this code produces from the fixed seed.
- **Committed metrics are real, but the data is absent** (a clean clone, or CI) → the exact numbers
  cannot be reproduced without the data, so this does not fail. It instead proves the pipeline is
  deterministic on the synthetic stand-in, which is the property CI can actually check.
- **Committed metrics are synthetic** → regenerate and diff, as always.

Writes nothing.
"""

from __future__ import annotations

import json
import sys

from .config import ARTIFACTS_DIR, DATA_DIR
from .run_eval import run


def main() -> int:
    committed_path = ARTIFACTS_DIR / "metrics.json"
    if not committed_path.exists():
        print("check-metrics — artifacts/metrics.json is missing. Run `make eval`.")
        return 1

    committed_text = committed_path.read_text(encoding="utf-8")
    committed = json.loads(committed_text)
    source = committed.get("provenance", {}).get("data_source")
    data_present = (DATA_DIR / "train_transaction.csv").exists()

    if source == "ieee-cis" and not data_present:
        print(
            "check-metrics — the committed metrics are from real IEEE-CIS, which is not committed "
            "(Kaggle rules forbid redistributing the data). The exact numbers cannot be regenerated "
            "here; verifying the pipeline is deterministic on the synthetic stand-in instead."
        )
        first = json.dumps(run(write=False, force_synthetic=True), sort_keys=True)
        second = json.dumps(run(write=False, force_synthetic=True), sort_keys=True)
        if first != second:
            print("check-metrics FAILED — the pipeline is not deterministic on the synthetic path.")
            return 1
        print(
            "check-metrics — pipeline deterministic (synthetic). Place train_transaction.csv in the "
            "data directory to verify the real numbers against this machine."
        )
        return 0

    regenerated = json.dumps(run(write=False), indent=2, sort_keys=True) + "\n"
    if committed_text != regenerated:
        print(
            "check-metrics FAILED — artifacts/metrics.json no longer matches what the pipeline "
            "produces. The model or the data changed and the metrics were not regenerated. Run "
            "`make eval` and commit the result."
        )
        return 1

    label = "real IEEE-CIS" if source == "ieee-cis" else "synthetic"
    print(f"check-metrics — metrics.json is current ({label})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
