# @checkstack/healthcheck-rcon-backend

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
