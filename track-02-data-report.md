# Sentinel Track 02 data-foundation report

Date: 2026-08-27. No ML weights or architecture were changed.

## 1. Data problems found

Replay rows could enter default Attempts results, and Overview risk was based on duplicate raw
lifecycle events instead of resolved attempts and correlated incidents. Durable policy governance
and a separate worker deployment path were also missing.

## 2. Where each problem originated

The source was the backend query/aggregation layer: Attempts had no default source predicate and
Overview counted canonical events. Incident correlation itself is backend-owned by detector
clustering, duplicate-view removal, and database upsert keys.

## 3. Seeded/static data removed

No production startup path seeds attempts or incidents. Demo users are development-only. Scenario
fixtures are inserted only through the authenticated replay route, refused in production, and can
be removed by source-scoped replay cleanup.

## 4. Live/replay separation

`event_source` is persisted on checkout, inbox, canonical event, and incident rows. Live Attempts
and Overview enforce `razorpay`; replay requires explicit `source=replay`.

## 5. How attempts are stored

Canonical webhook events remain immutable. Attempts are reconstructed by payment identity and a
deterministic lifecycle rank. Multiple authorized/captured/failed events for one payment are one
attempt; failed-then-captured is marked recovered. Checkout context is joined by order ID.

## 6. How incidents are created

Point-in-time features feed rules/change detection, the binary abuse model, hypothesis arbitration,
and policy decision. Clustered activity is upserted into one incident episode per correlation key,
with same-activity protection across session/device/network views.

## 7. How attempts link to incidents

Incident detail queries the incident entity kind/key, source, and activity time range against
checkout context and canonical events. It returns actual resolved orders and attempts and links to a
filtered Attempts route. Counts are derived from returned objects.

## 8. Duplicate incidents/events fixed

Webhook event IDs are unique. Canonical resolution groups lifecycle events. Detector clustering,
duplicate-view removal, incident keys, and same-activity checks prevent duplicate episodes. No
frontend deduplication is used.

## 9. Overview metrics

Attempt, captured, failed, and safe totals use resolved live attempts. Active/under-review/contained
totals use live incident rows. Recent activity uses live canonical events. Replay is excluded at the
query layer.

## 10. Risk meter

The backend returns zero when no live incidents exist. Otherwise it returns the highest stored live
incident score in the selected window: a conservative recent-risk indicator, not a claim that every
payment is fraudulent.

## 11. Top risk reasons

Live incidents are grouped by the arbitration winner. The API returns sorted counts and the console
calculates percentages from that returned total. No percentages are hardcoded.

## 12. ML audit

The deployed binary model was checked for versioned features, live compatibility, provenance,
held-out metrics, calibration, threshold, contribution output, abstention, and bounded scoring.

## 13. ML changes required

None. The model was not retrained or modified. Metrics remain synthetic-corpus metrics. Analyst
verdicts already provide the merchant-label seam for future training data.

## 14. Tests and results

API build/typecheck/lint, web build/typecheck/lint, 125 web tests, 33 incident integration tests,
11 Attempts integration tests, 15 environment tests, 15 containment integration tests, and the
policy workflow integration test all passed. Formatting and `git diff --check` passed.

## 15. Remaining data limitations

Real merchant labels and a public non-synthetic benchmark are unavailable and cannot be fabricated.
Razorpay must externally register `https://<azure-container-domain>/api/webhooks/razorpay` with the
matching secret. Azure must run the HTTP API and `start:worker` against the same durable database
and encryption keys. Policy API lifecycle is durable and approval-controlled; console authoring,
diff, and rollback presentation remain future UX work.
