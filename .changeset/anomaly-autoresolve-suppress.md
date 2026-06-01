---
"@checkstack/anomaly-backend": minor
"@checkstack/anomaly-common": minor
"@checkstack/anomaly-frontend": minor
---

Auto-resolve anomalies that settle at a new normal, and add global suppression.

Part A (bug fix): a confirmed anomaly used to stay stuck in `anomaly` indefinitely when the metric settled at a *new* stable level (the classic "broken, then fixed at a clearly different value" case) — every fresh sample was still anomalous against the stale baseline, so recovery only fired once the slow hourly analyzer dragged the mean across. Both detectors now carry a baseline-independent self-resolution path:

- Spike: each healthy sample for a confirmed anomaly is appended to a rolling window on the row's metadata; after `STABLE_RESOLUTION_RUN_COUNT` (5) consecutive samples sit within `STABLE_RESOLUTION_RELATIVE_BAND` (10%) of each other, the row self-resolves to `recovered`.
- Drift: when the projected change goes flat relative to the new mean for `STABLE_DRIFT_RESOLUTION_RUN_COUNT` (2) consecutive analyzer runs, the row self-resolves.

The original baseline-relative recovery path is unchanged.

Part B (feature): global (per-row, not per-user) suppression. New `suppressedAt` / `suppressedValue` / `suppressedBaseline` columns on the `anomalies` table (Drizzle migration `0005`), `suppressAnomaly` / `unsuppressAnomaly` RPCs gated by `anomaly_feed.manage`, and a `suppression` filter on `getAnomalies` (default `active` hides suppressed rows). Suppressed rows drop out of the dashboard badge/widget active count, and the widget exposes an eye-off suppress affordance on confirmed anomalies. Suppression auto-clears ("changes again") once the observed value moves more than `SUPPRESSION_REACTIVATION_DELTA` (25%) from the value it was suppressed at. All suppression state lives on the shared `anomalies` row (Postgres), so every pod reads the same active/suppressed set.

Distinct from the existing per-user notification mute, which only silences notifications while the row stays active.
