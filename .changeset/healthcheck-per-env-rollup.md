---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
---

Per-environment health semantics: rollup no longer masks sibling outages,
and notifications + automation windows are env-scoped.

## The bug

When a `(system, configuration)` assignment fanned out to multiple
environments and only some of them failed, the system rollup could
read **healthy** (masking a permanently-failing env), or **flap**
healthy↔degraded/unhealthy tick-by-tick whenever env insertion order
drifted, because the rollup derivation flattened every env's runs into
one `timestamp DESC` list and handed the interleaved list to the
threshold evaluator. The default `consecutive` mode walks newest-first
and breaks the streak on the first interleaving env, so the rollup
collapsed to whichever single env's status the most recent run landed
on. Each flap fired an escalation/recovery notification + a
`system_health_changed` trigger event.

## What changed

- **`getSystemHealthStatus(systemId)` rollup** now groups the latest
  run window by `environmentId`, evaluates the threshold window PER
  ENVIRONMENT, and takes worst-wins across envs within each association
  (unhealthy > degraded > healthy) before worst-wins across associations.
  This is stable regardless of env insertion order or multi-pod racing.
  For a single-env (or env-less-only) assignment this reduces to the
  pre-existing flat-window behavior. Per-env and env-less slices
  (`environmentId: string` / `null`) are unchanged.
- **`getSystemHealthOverview`** now groups runs per `(configurationId,
  environmentId)`, evaluates each env's slice on its own monotonic run
  window, and worst-wins across envs — mirroring `getSystemHealthStatus`.
  The response carries `environmentId` on every `recentRuns[]` entry,
  and adds `perEnvironment[]` per check (one entry per env with its own
  `status` and env-scoped `recentRuns`) so a frontend can render one
  row per `(check, environment)` pair, surfacing per-env outages the
  rollup intentionally hides in the aggregate view. The top-level
  `recentRuns[]` and `status` keep their pre-existing shape for
  backwards compatibility (single-env checks are unchanged).
- **`HealthCheckSystemOverview`** (frontend) now flattens multi-env
  assignments into one row per `(check, environment)` — each row carries
  the check name, an env pill (resolved via the same
  `getSystemEnvironments` query the drawer already uses), the per-env
  status, sparkline, and last-run. With the "Failing"/"Healthy" filter
  now scoped per env, a permanently-failing environment surfaces as its
  own failing row beside its healthy sibling, instead of being masked by
  the rollup's worst-wins / latest-wins. Single-env and env-less
  assignments render the historical single row (no env pill). Clicking
  any env row opens the check-level drawer, scoped to that env via the
  server-side env filter on the queries below — the drawer's run
  history table, charts, and tiles all see only the (check, environment)
  pair the operator clicked, never a mixed-env pool.
- **`getHistory`, `getDetailedHistory`, `getRunStats`,
  `getAggregatedHistory`, and `getDetailedAggregatedHistory`** now accept
  an optional `environmentId: string | null` input that filters
  server-side at the DB layer (`environment_id = $X` for an env, `IS
  NULL` for the env-less slice, no predicate when omitted). The drawer's
  charts and Recent Runs table pass the clicked row's `environmentId`
  so the pagination, totals, and buckets reflect only that env — a
  client-side filter would double-paginate and miscount totals; the
  filter is at the DB so the data is honest end-to-end. The aggregated
  history applies the env filter to all three tiers the cross-tier
  aggregation engine reads (raw `health_check_runs` + hourly and daily
  `health_check_aggregates`), since both tables are env-keyed. Single-env
  and env-less rows omit the filter, so historical callers are
  unchanged.
- **Anomaly baselines are NOT yet env-scoped** — `anomaly_baselines` is
  keyed on `(systemId, configurationId, fieldPath)` with no
  `environmentId` column, and the detector computes a single baseline
  across all envs of an assignment. Scoping the drawer's anomaly overlay
  per env needs a schema migration + a per-env detector rewrite, and is
  tracked as a follow-up. The drawer continues to show the cross-env
  baseline next to the (now env-scoped) history + charts.
- **`system_health_changed` / `system_degraded` / `system_healthy`
  triggers** now partition by `(systemId, environmentId)` instead of
  the bare `systemId` when the trigger fires from a per-env change.
  Two failing environments of one system now fire two distinct events
  with independent flapping/dwell/dedup windows — operators can author
  per-env automations and get per-env notifications. A bare rollup
  transition (`environmentId` absent) partitions on `systemId` alone,
  so existing recipes that read only `payload.systemId` keep working.
- **`notifyStateChange`** now accepts `environmentId` +
  `environmentName`. Per-env notifications get an env-qualified title
  (`"System health critical (prod): ..."`) and body, and an
  env-qualified collapse key (`systemHealthCollapseKey(systemId, envId)`)
  so two failing envs render as two independent cards instead of
  merging into one. Suppression checks (maintenance/incident) remain
  system-scoped.

## Notes

- Each failing env now fires its own `system_health_changed` event with
  its own partition — this is the documented migration away from the
  bug-report flapping cadence into a per-env flap cadence. Operators
  with existing `window:` / `dwell:` recipes on `system_health_changed`
  may see different refire cadence per env (one flapping env no longer
  drowns out its steady sibling). To opt back into the pooled
  historical behavior, an automation recipe can override its own
  `partitionBy: (p) => p.systemId`.
- `SYSTEM_STATUS_CHANGED` remains rollup-only (one broadcast per tick
  on the rollup status transition): it drives low-noise cache
  invalidation for `SystemHealthBadge` and `DependencyBadge`, and the
  per-env trigger events above already cover per-env automation needs.