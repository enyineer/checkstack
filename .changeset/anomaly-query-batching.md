---
"@checkstack/anomaly-backend": patch
---

Kill the N+1 query loops that made anomaly-backend the hottest ongoing scoped-db
load. Behavior unchanged; performance-only: the same anomaly rows, baselines,
state transitions, notifications, and signals are produced — only the query
shape and connection churn change.

- The inline spike detector (`processCheckCompleted`, runs on EVERY
  `checkCompleted`) now pre-loads ALL existing `spike` anomaly rows for the
  `(system, config, env)` slice in ONE set-based `SELECT` before the field loop
  and looks each field up in memory, instead of issuing one `SELECT` per field
  (an N+1 on the hottest path). A run carrying K fields now costs 1 anomalies
  read instead of K.
- The drift evaluator (`evaluateDrift`) accepts an optional batch-preloaded map
  of existing `drift` rows (`existingDriftRows`, built by the new
  `loadExistingDriftRows`). When supplied it reads the row from memory instead
  of issuing its own per-field `SELECT`; standalone callers/tests still resolve
  the row themselves.
- The hourly baseline analyzer:
  - Preloads BOTH per-assignment config reads (`getAnomalyConfigsByIds` +
    `getAnomalyAssignmentConfigsByKeys`) set-based for ALL assignments under a
    single `withScopedTransaction`, replacing `2 * N` standalone `SELECT`s with
    2. The `getRunsForAnalysis` RPC stays OUTSIDE the transaction.
  - Collapses the per-field baseline upsert into ONE multi-row
    `INSERT ... ON CONFLICT DO UPDATE` per environment (values taken from
    `excluded.*`), instead of one upsert per field.
  - Preloads existing `drift` rows once per environment via
    `loadExistingDriftRows` and threads the map into `evaluateDrift`, so drift
    evaluation no longer issues one `SELECT` per field.

State & scale: all reads still resolve from the shared Postgres tables, so every
pod returns the same answer; no process-local or duplicated state is introduced.
