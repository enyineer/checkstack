# @checkstack/healthcheck-rcon-backend

## 0.2.12

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
  - @checkstack/healthcheck-rcon-common@0.2.6

## 0.2.11

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/healthcheck-common@0.8.1
  - @checkstack/healthcheck-rcon-common@0.2.5

## 0.2.10

### Patch Changes

- Updated dependencies [d6f7449]
  - @checkstack/healthcheck-common@0.8.0

## 0.2.9

### Patch Changes

- Updated dependencies [1f81b60]
- Updated dependencies [090143b]
  - @checkstack/healthcheck-common@0.7.0

## 0.2.8

### Patch Changes

- Updated dependencies [11d2679]
  - @checkstack/healthcheck-common@0.6.0

## 0.2.7

### Patch Changes

- Updated dependencies [ac3a4cf]
- Updated dependencies [db1f56f]
  - @checkstack/healthcheck-common@0.5.0
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/healthcheck-rcon-common@0.2.4

## 0.2.6

### Patch Changes

- Updated dependencies [66a3963]
  - @checkstack/backend-api@0.5.0

## 0.2.5

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/healthcheck-common@0.4.2
  - @checkstack/healthcheck-rcon-common@0.2.3

## 0.2.4

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/healthcheck-common@0.4.1
  - @checkstack/healthcheck-rcon-common@0.2.2

## 0.2.3

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3

## 0.2.2

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/healthcheck-common@0.4.0
  - @checkstack/healthcheck-rcon-common@0.2.1

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.3.1

## 0.2.0

### Minor Changes

- 829c529: Add RCON healthcheck strategy for game server monitoring

  New RCON (Remote Console) healthcheck strategy for monitoring game servers via the Source RCON protocol:

  - **Generic Command Collector** - Execute arbitrary RCON commands
  - **Minecraft Players** - Get player count and names from `list` command
  - **Minecraft Server** - Get TPS for Paper/Spigot servers
  - **Source Status** - Get server hostname, map, and player counts (CS:GO/CS2)
  - **Source Players** - Get detailed player list from Source engine games

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
- Updated dependencies [829c529]
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/healthcheck-common@0.3.0
  - @checkstack/healthcheck-rcon-common@0.2.0
