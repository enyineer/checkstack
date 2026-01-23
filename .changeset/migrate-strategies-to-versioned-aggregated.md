---
"@checkstack/backend-api": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/healthcheck-dns-backend": minor
"@checkstack/healthcheck-grpc-backend": minor
"@checkstack/healthcheck-http-backend": minor
"@checkstack/healthcheck-jenkins-backend": minor
"@checkstack/healthcheck-mysql-backend": minor
"@checkstack/healthcheck-ping-backend": minor
"@checkstack/healthcheck-postgres-backend": minor
"@checkstack/healthcheck-rcon-backend": minor
"@checkstack/healthcheck-redis-backend": minor
"@checkstack/healthcheck-script-backend": minor
"@checkstack/healthcheck-ssh-backend": minor
"@checkstack/healthcheck-tcp-backend": minor
"@checkstack/healthcheck-tls-backend": minor
---

Migrate health check strategies to VersionedAggregated with _type discriminator

All 13 health check strategies now use `VersionedAggregated` for their `aggregatedResult` property, enabling automatic bucket merging with 100% mathematical fidelity.

**Key changes:**

- **`_type` discriminator**: All aggregated state objects now include a required `_type` field (`"average"`, `"rate"`, `"counter"`, `"minmax"`) for reliable type detection
- The `HealthCheckStrategy` interface now requires `aggregatedResult` to be a `VersionedAggregated<AggregatedResultShape>`
- Strategy/collector `mergeResult` methods return state objects with `_type` (e.g., `{ _type: "average", _sum, _count, avg }`)
- `mergeAggregatedBucketResults`, `combineBuckets`, and `reaggregateBuckets` now require `registry` and `strategyId` parameters
- `HealthCheckService` constructor now requires both `registry` and `collectorRegistry` parameters
- Frontend `extractComputedValue` now uses `_type` discriminator for robust type detection

**Breaking Change**: State objects now require `_type`. Merge functions automatically add `_type` to output. The bucket merging functions and `HealthCheckService` now require additional required parameters.

