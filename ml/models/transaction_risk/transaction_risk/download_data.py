"""Fetches the IEEE-CIS competition data — which this repository will never contain.

The data cannot be redistributed: Kaggle's competition rules forbid it, and the download endpoint
returns **403 until you have joined the competition and accepted its terms**. So this script does
not bundle the data or work around that gate. It documents the one legitimate path and puts the
files where the loader expects them, for a person who has joined.

    1. Create a Kaggle account and join "IEEE-CIS Fraud Detection".
    2. Accept the competition rules (this is what lifts the 403).
    3. Create an API token (kaggle.json) and place it per Kaggle's instructions.
    4. Run this script.

Absent the data, every other part of the pipeline runs on a deterministic synthetic stand-in, and
says so on every artefact. Nothing here is blocked on a file this repository is not allowed to hold.
"""

from __future__ import annotations

import subprocess
import sys

from .config import DATA_DIR

COMPETITION = "ieee-fraud-detection"
NEEDED = ["train_transaction.csv"]


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    try:
        import kaggle  # noqa: F401
    except Exception:
        print(
            "The kaggle CLI is not installed. `pip install kaggle`, then join the competition and "
            "accept its rules — the download 403s until you do. See this file's docstring."
        )
        return 2

    print(f"Downloading {COMPETITION} into {DATA_DIR} (this needs a joined, accepted competition)…")
    result = subprocess.run(
        ["kaggle", "competitions", "download", "-c", COMPETITION, "-p", str(DATA_DIR)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stderr.strip())
        print(
            "\nIf this is a 403, it means the competition has not been joined and its rules "
            "accepted on this account. That is the gate, and it is not one to be worked around."
        )
        return result.returncode

    print("Downloaded. Unzip train_transaction.csv into the data directory and re-run `make eval`.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
