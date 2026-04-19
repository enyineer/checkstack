# Satellite Health Check Execution — Design Document

> **Status**: Draft
> **Date**: 2026-04-19
> **Author**: Brainstorming session

## Overview

Checkstack Satellites are slim, stateless containers that execute health checks from multiple geographic regions. They connect to a central Checkstack core instance via WebSocket, receive their configuration dynamically, run checks on their own scheduling loop, and push results back to the core for storage and evaluation.

This enables multi-region monitoring: users can verify that their services are reachable from Frankfurt, New York, and Singapore — not just from the single location where Checkstack core is deployed.

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Result storage | Core-only (stateless satellite) | Simplicity; next check fills gaps from transient disconnects |
| Result delivery resilience | In-memory ring buffer (100 results) with retry on reconnect | Simple resilience without adding a persistence layer |
| Authentication | Pre-shared API token (env var) | Simple, revocable, aligns with self-hosted model |
| Dispatch model | Hybrid: Core sends config, satellite schedules locally | Resilient to disconnects; satellite keeps running checks |
| Package structure | Separate `core/satellite` package + `Dockerfile.satellite` | Genuinely slim image; clean dependency boundaries |
| Region assignment | Per-association (`systemHealthChecks` table) | Per-system granularity; aligns with existing override pattern |
| Liveness tracking | 15s heartbeat with DB persistence, 45s offline threshold | Fast detection; survives core restarts |
| Satellite metadata | Name + region label + key-value tags (JSONB) | Flexible filtering and grouping |
| Strategy loading | Bundle all strategies; version mismatch detection | Simple; negligible image size impact |
| Local + satellite execution | User-configurable `includeLocal` boolean | Additive model; user chooses whether core also runs checks |
| Health state evaluation | Per-source evaluation with worst-case aggregation | Any failing region = system unhealthy |

## Architecture

### New Packages

#### `core/satellite-common`
Shared protocol types and schemas consumed by both core-side and satellite-side packages.

- **Protocol Messages (Zod schemas)**:
  - Satellite → Core: `authenticate`, `heartbeat`, `result`, `strategy_error`
  - Core → Satellite: `authenticated`, `config_updated`, `shutdown`
- **Entity Schemas**: `SatelliteSchema`, `CreateSatelliteSchema`
- **Signal Definitions**: `SATELLITE_STATUS_CHANGED`, `SATELLITE_CONFIG_CHANGED`
- **RPC Contract**: Satellite management API (CRUD, token generation)
- **Access Rules**: `satellite.manage`, `satellite.read`
- **Constants**: Heartbeat interval (15s), offline threshold (45s), ring buffer capacity (100)

#### `core/satellite-backend`
Core-side satellite management plugin.

- **Database Schema** (`plugin_satellite`):
  ```
  satellites
  ├── id: UUID (PK)
  ├── name: text
  ├── region: text
  ├── tags: jsonb (key-value pairs)
  ├── tokenHash: text (bcrypt)
  ├── lastHeartbeatAt: timestamp
  ├── version: text (nullable)
  └── createdAt: timestamp
  ```
- **Token Service**: Generate cryptographically random tokens, store bcrypt hashes, validate on connect
- **WebSocket Handler**: Dedicated `/api/satellite/ws` endpoint
  - Authenticates satellites via token
  - Manages active connections (Map of satelliteId → WebSocket)
  - Receives results and writes to `healthCheckRuns` (with `sourceId`)
  - Pushes config updates to affected satellites
- **Heartbeat Monitor**: Recurring queue job (every 15s)
  - Checks `lastHeartbeatAt` for all satellites
  - Broadcasts `SATELLITE_STATUS_CHANGED` signal when status transitions
- **RPC Router**: CRUD for satellite management
  - `createSatellite` — Returns one-time visible token
  - `deleteSatellite` — Triggers cleanup hook
  - `listSatellites` — Includes live status derived from `lastHeartbeatAt`
  - `getSatellite` — Single satellite detail
- **Hook Subscriber**: On `satellite.removed`, scrubs the satellite ID from all `systemHealthChecks.satelliteIds` arrays. Empty arrays fall back to core-only execution.
- **Config Relay**: Subscribes to healthcheck config change hooks, pushes `config_updated` to affected connected satellites

#### `core/satellite-frontend`
Satellite management UI.

- **Satellite List Page**: Table showing name, region, tags, status (online/offline badge), version, version mismatch warnings
- **Create Satellite Dialog**: Name + region + tags form → generates token (shown once with copy-to-clipboard)
- **Delete Satellite**: Confirmation dialog, triggers cleanup

#### `core/satellite`
The satellite process itself. Slim, stateless, no HTTP server.

**Dependencies**: `satellite-common`, `backend-api` (for strategy types / execution utilities), all built-in health check strategy packages.

**Does NOT include**: PostgreSQL drivers, frontend, plugin manager, auth system, notification system, queue system.

### Modified Packages

#### `core/healthcheck-common`
- Add `satelliteIds: z.array(z.string()).optional()` to `AssociateHealthCheckSchema`
- Add `includeLocal: z.boolean().default(true)` to `AssociateHealthCheckSchema`

#### `core/healthcheck-backend`
- **Schema change**: Add `satelliteIds` (text array) and `includeLocal` (boolean, default true) columns to `systemHealthChecks` table
- **Schema change**: Add `sourceId` (text, nullable, FK to satellites) and `sourceLabel` (text, nullable) columns to `healthCheckRuns` table
- **Queue executor**: If association has `satelliteIds` and `includeLocal` is false, skip local execution
- **Health state evaluation**: Group runs by `sourceId`, evaluate per-source, aggregate with worst-case
- **Hook subscriber**: Listen to `satellite.removed` hook, scrub satellite IDs from associations

#### `core/healthcheck-frontend`
- **Association editor**: New "Execution Sources" section with satellite multi-select picker + "Include local" toggle
- **History views**: Source badge (pill) on each run row, source filter dropdown
- **System health overview**: Per-source status breakdown (e.g., "EU: ✅ | US: ❌ | Local: ✅")
- **Charts**: Option to split by source or view combined

## Communication Protocol

### WebSocket Endpoint
`/api/satellite/ws` — Dedicated endpoint, separate from user-facing signal WebSocket.

### Message Flow

#### Authentication
```
Satellite                    Core
   │                          │
   │──── authenticate ───────>│  { token: "sat_..." }
   │                          │  (validate token hash)
   │<─── authenticated ──────│  { satelliteId, config: [...] }
   │                          │
```

#### Steady State
```
Satellite                    Core
   │                          │
   │──── heartbeat ──────────>│  (every 15s, updates lastHeartbeatAt)
   │                          │
   │──── result ─────────────>│  (health check result, stored in DB)
   │                          │
   │<─── config_updated ─────│  (when config changes affect this satellite)
   │                          │
```

#### Disconnection & Reconnect
```
Satellite                    Core
   │                          │
   │  ✕ connection lost       │  (core detects via heartbeat timeout)
   │                          │
   │  (continues running      │  (marks satellite offline after 45s)
   │   checks locally,        │
   │   buffers results        │
   │   in ring buffer)        │
   │                          │
   │──── authenticate ───────>│  (reconnect with backoff: 1s→2s→4s→...→30s)
   │<─── authenticated ──────│  (fresh config payload)
   │──── result (buffered) ──>│  (flush ring buffer)
   │──── result (buffered) ──>│
   │                          │
```

### Message Schemas

#### Satellite → Core

| Message | Payload |
|---|---|
| `authenticate` | `{ token: string }` |
| `heartbeat` | `{ version: string, uptimeSeconds: number }` |
| `result` | `{ configId, systemId, status, latencyMs, result, executedAt }` |
| `strategy_error` | `{ strategyId, message }` |

#### Core → Satellite

| Message | Payload |
|---|---|
| `authenticated` | `{ satelliteId, assignments: [{ configId, systemId, strategyId, config, collectors, assertions, intervalSeconds }] }` |
| `config_updated` | `{ assignments: [...] }` (full replacement) |
| `shutdown` | `{ reason: string }` |

## Satellite Lifecycle

### Startup
1. Read `CHECKSTACK_CORE_URL` and `CHECKSTACK_SATELLITE_TOKEN` — fail fast if missing
2. Register all built-in health check strategies + collectors into local registry
3. Connect WebSocket to core, send `authenticate`
4. Receive `authenticated` with full config → start scheduling loops
5. Start heartbeat timer (15s interval)

### Execution Loop (per assignment)
1. Timer fires based on `intervalSeconds`
2. Execute via shared `createClient` → collectors → assertions pipeline
3. Build result with this satellite's ID as `sourceId`
4. Send `result` over WebSocket (or buffer if disconnected)

### Config Update
1. Receive `config_updated` from core
2. Diff against current schedules
3. Stop timers for removed assignments
4. Start timers for new assignments
5. Restart timers for changed intervals
6. Warn for unavailable strategies

### Reconnection
1. Exponential backoff with jitter (1s → 2s → 4s → ... → 30s max)
2. Scheduling loops continue during disconnect
3. On reconnect: re-authenticate → receive fresh config → flush buffer → reconcile schedules

## Health State Evaluation

### Per-Source Evaluation
With satellites, health check runs are attributed to a source. The evaluation model becomes:

1. **Group** recent runs by `sourceId` (null for core, UUID for satellites)
2. **Evaluate** each source independently using existing threshold logic (consecutive or window mode)
3. **Aggregate**: System status = worst status across all active sources

### Example
| Source | Recent Runs | Source Status |
|---|---|---|
| Local | ✅✅✅✅✅ | Healthy |
| EU Frankfurt | ❌❌❌❌❌ | Unhealthy |
| US East | ✅✅✅❌✅ | Healthy |

**System status: Unhealthy** (worst-case from EU Frankfurt)

### Edge Cases
- **Satellite removed**: Its `sourceId` is scrubbed from associations. Historical runs retain `sourceLabel` for display but are excluded from future evaluations.
- **Satellite offline**: Runs stop arriving from that source. After the offline threshold, it no longer contributes to the evaluation (it shouldn't drag the system to "unknown" forever).
- **All satellites removed from association**: Falls back to core-only execution (if `includeLocal` is true).

## Satellite Image

### `Dockerfile.satellite`
Minimal multi-stage build:
- **Stage 1 (builder)**: Install dependencies for satellite package + strategy packages only
- **Stage 2 (runtime)**: Bun Alpine + satellite source + strategy dependencies
- **No**: Frontend build, PostgreSQL drivers, full plugin ecosystem

### Environment Variables
| Variable | Required | Description |
|---|---|---|
| `CHECKSTACK_CORE_URL` | ✅ | WebSocket URL of core instance (e.g., `wss://checkstack.example.com`) |
| `CHECKSTACK_SATELLITE_TOKEN` | ✅ | Pre-shared API token generated in core UI |

## Version Mismatch Detection

1. Satellite reports its version on connect (from its `package.json`)
2. Core compares with its own version
3. If mismatched: **warning badge** in Satellite management UI — "Running v1.2.3, core is v1.3.0"
4. If satellite receives a config with an unknown strategy: reports `STRATEGY_NOT_AVAILABLE`, which surfaces in health check history as a clear error

## Testing Strategy

### `core/satellite-common`
- Zod schema validation for all protocol message types
- Shared constants and utility functions

### `core/satellite-backend`
- Token generation and validation (hash + compare)
- Heartbeat monitor logic (online/offline threshold detection)
- Config relay (correct satellites receive updates)
- Hook subscriber (satellite removal cleans up associations)
- WebSocket handler (auth flow, result ingestion, config push)
- Per-source health state evaluation (worst-case aggregation)

### `core/satellite`
- Scheduling loop lifecycle (start/stop/update timers)
- Ring buffer (capacity, flush order, overflow)
- Reconnection with exponential backoff + jitter
- Config diffing (add/remove/update assignments)
- Strategy availability checking

### Integration Tests
- Mock core WebSocket server ↔ satellite instance: dispatch config, verify results flow back
- Multi-source health state evaluation with mixed results
