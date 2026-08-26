# Model B — incident classifier

A calibrated multi-class classifier over the four hypothesis families (attack, outage, retry storm,
healthy traffic), with an **explicit abstain**: below a confidence bar the model declines rather than
guesses. It is linear and temperature-scaled, so the API serves it directly as a few dot products —
no native runtime — and its per-feature contributions are exact SHAP for a linear model.

```bash
pip install -r requirements.txt
node ../../../ml/models/incident/export_training.mjs   # regenerate training.csv from the corpus
make eval                                              # writes model.json, registry.json, metrics.json
make test                                              # split integrity, parity, reproducibility
```

`make eval` is deterministic from a fixed seed. The training table is produced by a TypeScript
exporter that computes features with the **same `@sentinel/detect` functions the API uses at scoring
time**, so the model trains on exactly the numbers it will later score.

## Honesty discipline

- **Grouped split.** Rows are grouped by scenario instance; a seed the model trained on never appears
  in the test set, so the score measures generalisation, not memory.
- **Corpus hardening.** If the model scores above a stated macro-F1, the corpus is deemed too easy: a
  round of feature noise is added and the model re-scored *before* the number is reported.
- **Ablation ladder.** Macro-F1 with feature groups removed, which shows the traffic-context features
  are what separate an outage from a distributed attack — a per-entity view cannot.
- **Advisory only.** The deterministic rules and arbitration decide what is *done*; this informs that
  decision and never overrides it.

## ONNX

The served artefact is `model.json`. An ONNX graph of a linear model computes exactly the same
thing, and export is available under `INCIDENT_EXPORT_ONNX=1` — off by default because the converter
(`skl2onnx`) needs a numpy that conflicts with the pin the rest of the ML work uses, and segfaults
against it. A reviewer on a compatible toolchain gets the `.onnx`; nobody's request path depends on
it.
