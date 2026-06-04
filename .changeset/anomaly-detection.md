---
"@checkstack/anomaly-backend": minor
"@checkstack/anomaly-common": minor
"@checkstack/anomaly-frontend": minor
---

Auto-resolve anomalies that settle at a new normal, and add global suppression.

Part A (bug fix): a confirmed anomaly used to stay stuck in `anomaly` indefinitely when the metric settled at a new stable level. Both detectors now carry a baseline-independent self-resolution path - spike: after `STABLE_RESOLUTION_RUN_COUNT` (5) consecutive healthy samples within `STABLE_RESOLUTION_RELATIVE_BAND` (10%) the row self-resolves to `recovered`; drift: when the projected change goes flat relative to the new mean for `STABLE_DRIFT_RESOLUTION_RUN_COUNT` (2) analyzer runs. The original baseline-relative recovery path is unchanged.

Part B (feature): global (per-row) suppression. New `suppressedAt` / `suppressedValue` / `suppressedBaseline` columns (Drizzle migration `0005`), `suppressAnomaly` / `unsuppressAnomaly` RPCs gated by `anomaly_feed.manage`, and a `suppression` filter on `getAnomalies` (default `active` hides suppressed rows). Suppressed rows drop out of the dashboard badge/widget active count; the widget exposes an eye-off suppress affordance. Suppression auto-clears once the observed value moves more than `SUPPRESSION_REACTIVATION_DELTA` (25%) from the value it was suppressed at. All suppression state lives on the shared `anomalies` row, so every pod reads the same active/suppressed set. Distinct from the existing per-user notification mute.

This is a beta minor.
