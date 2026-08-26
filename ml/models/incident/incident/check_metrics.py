"""Regenerates the metrics in memory and fails if they differ from the committed file."""
from __future__ import annotations
import json, sys
from .config import ARTIFACTS_DIR
from .run_eval import run

def main() -> int:
    committed = ARTIFACTS_DIR / "metrics.json"
    if not committed.exists():
        print("check-metrics — metrics.json missing. Run `make eval`.")
        return 1
    if committed.read_text(encoding="utf-8") != json.dumps(run(write=False), indent=2, sort_keys=True) + "\n":
        print("check-metrics FAILED — metrics.json no longer matches the pipeline. Run `make eval`.")
        return 1
    print("check-metrics — metrics.json is current")
    return 0

if __name__ == "__main__":
    sys.exit(main())
