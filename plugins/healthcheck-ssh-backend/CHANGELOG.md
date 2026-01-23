# @checkstack/healthcheck-ssh-backend

## 0.2.1

### Patch Changes

- 869b4ab: ## Health Check Execution Improvements

  ### Breaking Changes (backend-api)

  - `HealthCheckStrategy.createClient()` now accepts `unknown` instead of `TConfig` due to TypeScript contravariance constraints. Implementations should use `this.config.validate(config)` to narrow the type.

  ### Features

  - **Platform-level hard timeout**: The executor now wraps the entire health check execution (connection + all collectors) in a single timeout, ensuring checks never hang indefinitely.
  - **Parallel collector execution**: Collectors now run in parallel using `Promise.allSettled()`, improving performance while ensuring all collectors complete regardless of individual failures.
  - **Base strategy config schema**: All strategy configs now extend `baseStrategyConfigSchema` which provides a standardized `timeout` field with sensible defaults (30s, min 100ms).

  ### Fixes

  - Fixed HTTP and Jenkins strategies clearing timeouts before reading the full response body.
  - Simplified registry type signatures by using default type parameters.

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0

## 0.2.0

### Minor Changes

- 3dd1914: Migrate health check strategies to VersionedAggregated with \_type discriminator

  All 13 health check strategies now use `VersionedAggregated` for their `aggregatedResult` property, enabling automatic bucket merging with 100% mathematical fidelity.

  **Key changes:**

  - **`_type` discriminator**: All aggregated state objects now include a required `_type` field (`"average"`, `"rate"`, `"counter"`, `"minmax"`) for reliable type detection
  - The `HealthCheckStrategy` interface now requires `aggregatedResult` to be a `VersionedAggregated<AggregatedResultShape>`
  - Strategy/collector `mergeResult` methods return state objects with `_type` (e.g., `{ _type: "average", _sum, _count, avg }`)
  - `mergeAggregatedBucketResults`, `combineBuckets`, and `reaggregateBuckets` now require `registry` and `strategyId` parameters
  - `HealthCheckService` constructor now requires both `registry` and `collectorRegistry` parameters
  - Frontend `extractComputedValue` now uses `_type` discriminator for robust type detection

  **Breaking Change**: State objects now require `_type`. Merge functions automatically add `_type` to output. The bucket merging functions and `HealthCheckService` now require additional required parameters.

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0

## 0.1.14

### Patch Changes

- 48c2080: Migrate aggregation from batch to incremental (`mergeResult`)

  ### Breaking Changes (Internal)

  - Replaced `aggregateResult(runs[])` with `mergeResult(existing, run)` interface across all HealthCheckStrategy and CollectorStrategy implementations

  ### New Features

  - Added incremental aggregation utilities in `@checkstack/backend-api`:
    - `mergeCounter()` - track occurrences
    - `mergeAverage()` - track sum/count, compute avg
    - `mergeRate()` - track success/total, compute %
    - `mergeMinMax()` - track min/max values
  - Exported Zod schemas for internal state: `averageStateSchema`, `rateStateSchema`, `minMaxStateSchema`, `counterStateSchema`

  ### Improvements

  - Enables O(1) storage overhead by maintaining incremental aggregation state
  - Prepares for real-time hourly aggregation without batch accumulation

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/healthcheck-common@0.8.2
  - @checkstack/healthcheck-ssh-common@0.1.8

## 0.1.13

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/healthcheck-common@0.8.1
  - @checkstack/healthcheck-ssh-common@0.1.7

## 0.1.12

### Patch Changes

- Updated dependencies [d6f7449]
  - @checkstack/healthcheck-common@0.8.0

## 0.1.11

### Patch Changes

- Updated dependencies [1f81b60]
- Updated dependencies [090143b]
  - @checkstack/healthcheck-common@0.7.0

## 0.1.10

### Patch Changes

- Updated dependencies [11d2679]
  - @checkstack/healthcheck-common@0.6.0

## 0.1.9

### Patch Changes

- Updated dependencies [ac3a4cf]
- Updated dependencies [db1f56f]
  - @checkstack/healthcheck-common@0.5.0
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/healthcheck-ssh-common@0.1.6

## 0.1.8

### Patch Changes

- Updated dependencies [66a3963]
  - @checkstack/backend-api@0.5.0

## 0.1.7

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/healthcheck-common@0.4.2
  - @checkstack/healthcheck-ssh-common@0.1.5

## 0.1.6

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/healthcheck-common@0.4.1
  - @checkstack/healthcheck-ssh-common@0.1.4

## 0.1.5

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3

## 0.1.4

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/healthcheck-common@0.4.0
  - @checkstack/healthcheck-ssh-common@0.1.3

## 0.1.3

### Patch Changes

- @checkstack/backend-api@0.3.1

## 0.1.2

### Patch Changes

- f533141: Enforce health result factory function usage via branded types

  - Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
  - Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
  - Added branded `HealthResultField<T>` type to mark schemas created by factory functions
  - Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
  - Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
  - Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/healthcheck-common@0.3.0
  - @checkstack/healthcheck-ssh-common@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0
  - @checkstack/healthcheck-ssh-common@0.1.1

## 0.1.0

### Minor Changes

- f5b1f49: Refactored health check strategies to use `createClient()` pattern with built-in collectors.

  **Strategy Changes:**

  - Replaced `execute()` with `createClient()` that returns a transport client
  - Strategy configs now only contain connection parameters
  - Collector configs handle what to do with the connection

  **Built-in Collectors Added:**

  - DNS: `LookupCollector` for hostname resolution
  - gRPC: `HealthCollector` for gRPC health protocol
  - HTTP: `RequestCollector` for HTTP requests
  - MySQL: `QueryCollector` for database queries
  - Ping: `PingCollector` for ICMP ping
  - Postgres: `QueryCollector` for database queries
  - Redis: `CommandCollector` for Redis commands
  - Script: `ExecuteCollector` for script execution
  - SSH: `CommandCollector` for SSH commands
  - TCP: `BannerCollector` for TCP banner grabbing
  - TLS: `CertificateCollector` for certificate inspection

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/healthcheck-ssh-common@0.1.0
  - @checkstack/common@0.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/healthcheck-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/healthcheck-common@0.0.2

## 0.0.3

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/healthcheck-common@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/healthcheck-common@0.1.0
