---
"@checkstack/anomaly-backend": minor
"@checkstack/anomaly-common": minor
"@checkstack/anomaly-frontend": minor
---

Scope anomaly rows by (check, environment), completing the deferred follow-up
from the per-environment work in #375 (which env-scoped only baselines).

Previously the `anomalies` table was cross-environment: the inline spike
detector and the drift evaluator located and created the open row by
`(systemId, configurationId, fieldPath, kind)` with no environment predicate.
When a `(system, configuration)` assignment fanned out to multiple environments,
a healthy value in environment A shared one row with an anomaly in environment B,
so one env could mask (or merge with) another.

- **Schema.** New nullable `anomalies.environment_id` column (migration
  `0007_uneven_trauma.sql`, a single `ADD COLUMN`). No unique constraint is
  added: the table intentionally allows multiple rows per identity tuple (a
  `recovered` historical row plus a fresh active row), so uniqueness would break
  the state machine.
- **Detection.** The spike detector (from the `checkCompleted` hook) and the
  drift evaluator (from the analyzer's per-environment loop) now locate/create
  the open row by `(systemId, configurationId, environmentId, fieldPath, kind)`,
  matching `environment_id = <id>` when present or `IS NULL` for the env-less
  slice - mirroring the per-environment baseline lookup.
- **Reads.** `getAnomalies` gains an optional `environmentId` tristate filter
  (`undefined` = all envs, `null` = env-less slice, string = that env), and both
  `AnomalyDto` and `getActiveSignalAnomalies` surface `environmentId`. The
  system-detail widget renders an environment pill on env-scoped anomaly rows.
- **Notifications.** An env-scoped anomaly appends its environment id to the
  collapse key, so two failing environments render as two independent cards
  instead of collapsing into one. The env-less slice keeps the pre-feature
  two-segment key. Mutes stay env-agnostic (per system / per field).

BREAKING (semantics, not types; BETA so minor only):

- **Anomaly row identity now includes `environmentId`.** For a fanned-out check,
  an anomaly in one environment is a distinct row from another environment. Any
  code that assumed a single anomaly row per `(system, config, field, kind)`
  must account for the environment dimension.
- **`AnomalyDto` and `getActiveSignalAnomalies` rows carry a new
  `environmentId: string | null` field**, and `getAnomalies` accepts a new
  optional `environmentId` filter. Additive on the wire; consumers that reject
  unknown fields should be updated.
- **Upgrade behaviour.** Existing rows backfill to `null` (the env-less slice)
  and stay until they recover; the next detection tick opens fresh
  per-environment rows for fanned-out checks. This mirrors how #375 handled
  baselines.

State and scale: the anomaly state lives entirely in the shared `anomalies`
Postgres table. `environmentId` is just another column on the row, so every pod
reads the same per-`(system, config, env, field, kind)` state - no pod-local
state, and reads return the same answer on every pod. The baseline cache key
already carries the env segment (#375), so there is no cross-env cache shadowing.
