# @checkstack/healthcheck-rcon-common

## 0.2.9

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5

## 0.2.8

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
  - @checkstack/common@0.6.4

## 0.2.7

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/common@0.6.3

## 0.2.6

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/common@0.6.2

## 0.2.5

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/common@0.6.1

## 0.2.4

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0

## 0.2.3

### Patch Changes

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [83557c7]
  - @checkstack/common@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0

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
- Updated dependencies [f533141]
  - @checkstack/common@0.2.0
