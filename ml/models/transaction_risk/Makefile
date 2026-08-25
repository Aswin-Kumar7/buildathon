# From the package directory. `python` is whatever is on PATH; override with `make eval PY=python3`.
PY ?= python

.PHONY: eval test check-metrics

eval:
	$(PY) -m transaction_risk.run_eval

# Split integrity and reproducibility. Not run by the JS gate — this is the Python side.
test:
	$(PY) -m pytest -q

# Regenerate metrics into a temp file and fail if it differs from the committed one. The
# `make audit-verify` equivalent for the model: proof the committed numbers are the ones the code
# produces, not a stale snapshot.
check-metrics:
	$(PY) -m transaction_risk.check_metrics
