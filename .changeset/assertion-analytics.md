---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
---

Make collector assertions analyzable: structured per-assertion outcomes on
every run, pass/fail counts in every aggregate tier, and dedicated analysis
surfaces. Previously a passing assertion left no trace and only the first
failure was recorded as a string.

- `@checkstack/healthcheck-common` adds the assertion-analytics contract:
  `AssertionOutcomeSchema`, per-bucket `BucketAssertionStats` (stored under
  the platform-owned top-level `assertions` key of `aggregatedResult`), and
  the canonical assertion identity key (`computeAssertionKey` /
  `parseAssertionKey`, a JSON tuple of field/jsonPath/operator/value).
  Editing an assertion starts a new series; identical duplicates collapse.
- The executor evaluates ALL assertions (no first-failure short-circuit) and
  stores `_assertions` on each collector entry alongside the unchanged
  `_assertionFailed` compatibility string. Pass/fail counts are folded into
  the hourly realtime aggregation, the on-read raw tier, cross-tier bucket
  re-merges, and the daily retention rollup (assertion counts are the only
  `aggregatedResult` content that survives the rollup - they are purely
  additive), so assertion analytics do not silently end at the hourly
  retention horizon.
- Satellite ingest now evaluates assertions on the core
  (`ingestSatelliteResult`), downgrading a satellite-reported healthy run
  whose assertions fail, and strips ephemeral result fields (e.g. raw HTTP
  bodies) at ingest for parity with local runs. BEHAVIOR CHANGE:
  satellite-executed checks previously never enforced assertions at all;
  they now do, with no satellite upgrade or wire-protocol change. Buffered
  satellite results are evaluated against the configuration current at
  ingest time.
- The run detail gains an Assertions tab (per-collector groups, pass AND
  fail rows with expected vs actual, a legacy fallback for pre-feature
  runs), and the drawer's auto-chart grid leads each collector group with
  per-assertion pass-rate tiles (sparkline of per-bucket pass rate,
  expandable to a pass/fail StackedTimeline; currently-configured assertions
  appear before any data exists, historical-only series are flagged).

State & scale: all new state lives in the existing `healthCheckRuns.result`
and `healthCheckAggregates.aggregated_result` jsonb columns (durable, shared
Postgres - no new tables, no pod-local state); reads resolve identically on
every pod; the run-vs-bucket duplication is the platform's existing
raw-vs-aggregate tiering with the existing single-writer upsert paths.
