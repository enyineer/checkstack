---
title: "System Dependencies — Design Document"
description: "Date: 2026-04-17 Status: Draft"
---
# System Dependencies — Design Document

**Date**: 2026-04-17
**Status**: Draft

## Overview

Add optional, directional dependencies between catalog systems with configurable impact types. When an upstream system degrades or goes down, dependent downstream systems display visual warnings in the dashboard — without overriding their own real status. This gives operators immediate visibility into blast radius and cascading failures.

## Key Decisions

| Decision | Choice |
|---|---|
| Relationship model | Directional with impact types (A depends on B) |
| Status propagation | Visual-only — warnings layered on top of real status |
| Health check granularity | Included in v1, behind "Advanced" toggle |
| Propagation depth | Per-dependency toggle: single-hop (default) or transitive |
| Architecture | Dedicated core plugins (`dependency-backend/common/frontend`) |
| Desktop editing | Interactive graph canvas + inline list editor |
| Mobile editing | Read-only graph + inline list editor |
| Graph library | React Flow (custom nodes/edges, pan/zoom, persistence) |

---

## 1. Data Model

New schema: `plugin_dependency`

### `dependencies` table

| Column | Type | Description |
|---|---|---|
| `id` | text (PK) | Unique dependency ID |
| `sourceSystemId` | text | The **dependent** system (downstream) |
| `targetSystemId` | text | The system being depended on (upstream) |
| `impactType` | enum | `informational` / `degraded` / `critical` |
| `transitive` | boolean (default: false) | If true, consider upstream's own dependency warnings (multi-hop) |
| `label` | text? | Optional human-readable label (e.g., "Auth Provider") |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

**Constraints**:
- Unique on `(sourceSystemId, targetSystemId)` — no duplicate edges
- `sourceSystemId !== targetSystemId` — no self-references

### `dependency_health_check_rules` table

| Column | Type | Description |
|---|---|---|
| `id` | text (PK) | |
| `dependencyId` | text (FK → dependencies) | Parent dependency, cascade delete |
| `healthCheckId` | text | Specific health check on the upstream system |
| `overrideImpactType` | enum | Override impact when this specific check fails |

When no rules exist, the dependency reacts to the upstream's **overall aggregated status**. When rules exist, only specified checks trigger the impact, each with its own override impact type.

---

## 2. Status Propagation Logic

The dependency plugin **never modifies** a system's real status. It computes **derived warnings** displayed alongside the system's own badges.

### Evaluation Flow

1. A signal fires: "System B's status changed"
2. Look up all dependencies where `targetSystemId = B`
3. For each downstream system A:
   - **No health check rules**: Evaluate B's overall status against the `impactType` matrix
   - **Has health check rules**: Check only specified checks' latest results, use `overrideImpactType`
4. The **worst derived state** across all of A's upstream dependencies becomes A's dependency warning

### Impact Matrix

| Impact Type | Upstream `degraded` | Upstream `down` |
|---|---|---|
| `informational` | ℹ️ info badge | ℹ️ info badge |
| `degraded` | ⚠️ degraded warning | ⚠️ degraded warning |
| `critical` | ⚠️ degraded warning | 🔴 down warning |

### Transitive Propagation

- **`transitive: false`** (default): Only evaluate upstream's own health status
- **`transitive: true`**: Evaluate upstream's *effective* status — the worst of its own status and its own derived dependency warnings

### Cycle Protection

- **Creation time**: DFS/BFS from target system. If it reaches the source, reject with descriptive error including the full cycle path (e.g., "API → Database → Cache → API")
- **Evaluation time**: Visited-set guard as a safety net to prevent infinite loops

### Caching

Derived warnings are computed on status change signals and cached — not polled.

---

## 3. Editor UI — Inline List Editor

Injected into each system's detail/config page via `SystemDetailsSlot`. Two tabs:

### "Depends On" tab (editable)

Each dependency renders as a compact card row:

```
┌─────────────────────────────────────────────────────┐
│  🔗 Database Server          [critical ▾]  [× Remove]│
│     ├ Transitive: off                                │
│     └ Advanced ▸ (collapsed)                         │
└─────────────────────────────────────────────────────┘
```

- **System selector**: Searchable combobox, filters out already-added systems
- **Impact type**: Color-coded dropdown pill (blue / amber / red)
- **Transitive toggle**: Simple switch, defaults to off
- **"Advanced" collapsible**: Expands to show upstream's health checks as multi-select checklist. Unchecked = react to overall status. Each checked item can have its own override impact type
- **Optional label**: Inline editable text field
- **"+ Add Dependency"** button opens the combobox inline (no modal)

### "Depended By" tab (read-only)

Shows which other systems depend on *this* system with their impact types. Useful for understanding blast radius before maintenance.

---

## 4. Interactive Dependency Graph Canvas

A dedicated **"Dependency Map"** page registered via the plugin's route system.

### Rendering

Force-directed graph using **React Flow** with custom nodes and edges.

### Node Design

```
┌──────────────────────┐
│  ● Database Server   │  ← colored dot = current status
│    3 checks healthy  │  ← health summary subtitle
└──────────────────────┘
```

- Subtle glow/ring if the system has active dependency warnings
- Draggable; positions persisted per user (localStorage)

### Edge Design

- Directed arrows: downstream → upstream (arrow points to the dependency)
- Color-coded by impact type: blue (informational), amber (degraded), red (critical)
- Dashed line for `transitive: true`, solid for single-hop
- Hover tooltip: label, impact type, health check rules

### Desktop Editing Interactions

- **Create**: Drag from node's connection handle to another → popover for configuration
- **Edit**: Click edge → popover with full options (impact, transitive, advanced rules)
- **Delete**: Select edge → Delete key or popover remove button
- **Cycle prevention**: Invalid drop target highlights red with "Circular dependency" tooltip

### Mobile Behavior

- Read-only canvas with pan/zoom via touch gestures
- Tap node → bottom sheet with dependency details
- Tap edge → configuration summary
- No connection handles or drag-to-connect

---

## 5. Dashboard Integration

All integration via existing **extension slots** — no changes to catalog or dashboard plugins.

### `SystemStateBadgesSlot` Extension

A new badge next to existing health/incident/maintenance badges:

```
API Server  ✅ Healthy  🔧 Maintenance  ⚠️ 1 dependency degraded
```

- Shows the **worst** derived state across all upstream dependencies
- Click navigates to system dependency details or opens popover listing affected upstreams

### `SystemDetailsTopSlot` Extension

Prominent alert banner on system detail pages:

```
┌──────────────────────────────────────────────────────────┐
│  ⚠️ Upstream dependency "Database Server" is DOWN        │
│     Impact: critical — this system is considered DOWN     │
│     [View Dependency Map]                                 │
└──────────────────────────────────────────────────────────┘
```

- Stacks if multiple upstreams are affected
- Links to upstream system and dependency map

### Signal-Driven Reactivity

Subscribes to health check, incident, and maintenance status change signals. On upstream changes, recomputes downstream warnings and emits `dependency.warnings.changed` signal for real-time badge refresh.

### Performance

Uses the `SystemBadgeDataProvider` pattern — bulk fetch all dependency warnings for visible systems in one query, avoiding N+1.

---

## 6. Plugin Architecture

### `core/dependency-common`

- Zod schemas: `DependencySchema`, `HealthCheckRuleSchema`, `DependencyWarningSchema`, `ImpactTypeSchema`
- RPC contract with `createClientDefinition`
- Route definitions
- Extension slot definitions (if any new ones needed)

### Key RPC Procedures

| Procedure | Type | Description |
|---|---|---|
| `getDependencies` | query | Get all dependencies for a system (both directions) |
| `getAllDependencies` | query | Full graph for the canvas |
| `createDependency` | mutation | With cycle detection |
| `updateDependency` | mutation | Modify impact type, rules, transitive |
| `deleteDependency` | mutation | Remove dependency |
| `getWarnings` | query | Bulk-fetch derived warnings for badge provider |
| `getWarningsForSystem` | query | Single system warnings |

### `core/dependency-backend`

- Router with `autoAuthMiddleware`
- `DependencyService` for CRUD + cycle detection
- `WarningEvaluationService` for derived state computation
- Signal listeners for health check / incident / maintenance changes
- Distributed Hook Pattern registration for catalog system deletion cleanup

### `core/dependency-frontend`

- `DependencyEditor` component (inline list editor)
- `DependencyMap` page (React Flow canvas)
- `DependencyBadge` (SystemStateBadgesSlot extension)
- `DependencyAlert` (SystemDetailsTopSlot extension)
- `DependencyBadgeDataProvider` (bulk fetch pattern)

---

## 7. Error Handling

- **Cycle detection**: Reject with descriptive error including full cycle path
- **Self-referencing**: Rejected at contract level via Zod `.refine()`
- **Deleted health checks**: Rules cleaned up via Distributed Hook Pattern; dependency falls back to overall status evaluation (graceful degradation)
- **Orphan cleanup**: System deletion in catalog cascade-deletes all referencing dependencies

---

## 8. Testing Strategy

### Unit Tests
- Cycle detection algorithm (DFS/BFS)
- Impact matrix evaluation
- Transitive propagation logic with visited-set guard
- Warning computation with mocked system statuses

### Integration Tests
- Full RPC round-trip: create → status change → verify warnings
- Cascade deletion on system removal
- Health check rule fallback on check deletion

### Edge Cases
- Circular dependency rejection with full path reporting
- Transitive chains 3+ hops deep
- Mixed health-check-rule and system-level dependencies on the same upstream
- Concurrent status changes

---

## 9. Out of Scope (v1)

- Notification integration (alerts when dependency warnings trigger)
- Historical dependency state tracking
- Import/export of dependency graphs
