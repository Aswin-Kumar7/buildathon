"""The deployed card-testing risk model. A binary calibrated logistic that scores P(abuse) for an
entity, trained on the synthetic scenario corpus and split so no scenario seed leaks across the
divide. Served as the linear form it actually is — a few dot products in the request path — and
measured, on a held-out grouped split, with the same honest suite the reader sees on the model page."""
