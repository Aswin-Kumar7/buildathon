PY ?= python
.PHONY: eval test check-metrics
eval:
	$(PY) -m incident.run_eval
test:
	$(PY) -m pytest -q
check-metrics:
	$(PY) -m incident.check_metrics
