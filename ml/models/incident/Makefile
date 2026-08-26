PY ?= python
.PHONY: eval test check-metrics export-labels
eval:
	$(PY) -m incident.run_eval
test:
	$(PY) -m pytest -q
check-metrics:
	$(PY) -m incident.check_metrics
# Pull confirmed merchant labels out of the database into data/merchant_labels.csv, which `eval`
# then trains on alongside the synthetic corpus. Empty until the system runs on real traffic.
export-labels:
	node export_labels.mjs
