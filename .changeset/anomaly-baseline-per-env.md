---
"@checkstack/anomaly-backend": minor
"@checkstack/anomaly-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
---

Anomaly baselines are now per-environment, so the env-scoped
`HealthCheckDrawer` shows the clicked env's baseline (not a cross-env
one). Closes the follow-up noted in `healthcheck-per-env-rollup`.

## What changed

- **`anomaly_baselines`** now carries a nullable `environment_id`
  column, and its unique constraint grew to
  `(systemId, configurationId, environmentId, fieldPath)` with
  `NULLS NOT DISTINCT` — so there is exactly one baseline per
  `(system, config, env, path)` tuple, and the env-less slice (`NULL`)
  stays a single row (the pre-feature cross-env baseline, preserved as
  the env-less row until the next analyzer tick rewrites per-env rows).
  Existing rows backfill to `environment_id = NULL` with no data work.
- **Baseline analyzer** (`jobs/baseline-analyzer.ts`) now fans out per
  environment within each assignment: runs are grouped by
  `environmentId` (null = env-less), stats are computed per env, and
  the upsert targets the 4-tuple. The cache key gained an env segment
  (`baseline:${config}:${system}:${env ?? "<none>"}:${path}`) and the
  `ANOMALY_BASELINE_UPDATED` signal payload now carries `environmentId`.
  Previously the analyzer computed one cross-env batch per assignment.
- **Inline detector** (`detector.ts`) resolves the per-env baseline:
  the lookup matches `environmentId` when present or `IS NULL` for the
  env-less slice, and the cache key matches the analyzer's env segment.
  `environmentId` is threaded from the `checkCompleted` hook (see
  below); it defaults to `null` (env-less) so a caller that omits it
  resolves the env-less baseline rather than failing.
- **`getAnomalyBaselines` RPC** now accepts an optional
  `environmentId: string | null` filter and surfaces `environmentId` on
  every `AnomalyBaselineDto`. Tristate semantics, mirroring
  `getHistory`: `undefined` → all envs (no predicate), `null` → env-less
  slice (`IS NULL`), a string → that env. The service predicate is at
  the DB layer.
- **`HealthCheckDrawer`** threads `item.environmentId` (already on its
  props) into the baselines query, so the drawer's anomaly overlay
  resolves server-side to the clicked env's baseline only — matching the
  env-scoping already applied to its history table and charts. The
  latency chart tolerates the new field (it picks the single
  `"latencyMs"` baseline, which the env filter guarantees is unique).
- **`getRunsForAnalysis`** (healthcheck) now returns `environmentId`
  on each run so the analyzer can group by env. Additive optional
  field; only the analyzer consumes it.
- **`checkCompleted` / `checkFailed` hooks** (healthcheck) now carry
  `environmentId: string | null` on their payloads, sourced from the
  per-env execution loop. Only the anomaly detector subscribes to
  `checkCompleted` (it was updated); the failure-path emit (rollup
  error) passes `null`.

## Notes

- Anomaly *rows* (`anomalies` table) remain cross-env by design in this
  step — only baselines are env-scoped, matching the scoped task. A
  detector run for env A and env B's normal value still share one
  `(system, config, path)` anomaly row; env-scoping the anomalies table
  is tracked as a separate follow-up so this change stays focused on
  the drawer's baseline overlay.
- The `checkCompleted` / `checkFailed` payload change is technically
  breaking for hook subscribers that destructure the payload, but the
  only in-tree subscriber (the anomaly plugin) was updated in lockstep.
  External webhook subscribers receive an additional field and are not
  affected unless they reject unknown keys (uncommon).
- Migration `0006_sad_retro_girl.sql` drops + recreates the unique
  constraint with `NULLS NOT DISTINCT` and adds the column. It applies
  cleanly to fresh and already-populated DBs (existing NULL-env rows
  remain unique under the new key).