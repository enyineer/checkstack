# Infrastructure Configuration

The Infrastructure Settings page is a centralized, pluggable surface for
infrastructure concerns (Queue, Cache, …). It is owned by
`core/infrastructure-frontend`, but the actual tabs are contributed by plugins
via the standard slot-extension mechanism in `@checkstack/frontend-api`.

## Architecture

```
core/infrastructure-common    → InfrastructureTabsSlot, routes, shared types
core/infrastructure-frontend  → Shell page (IDE Editor pattern), user menu
```

Dependency direction is **inverse**: each contributing plugin depends on
`@checkstack/infrastructure-common` to import the slot. The shell in
`infrastructure-frontend` does **not** depend on the contributing plugins.

## Design Pattern — IDE Editor Tabs with Stacked Sub-sections

The page uses a vertical tab bar on the left with a content area on the right,
similar to an IDE editor's settings panel. Each tab body stacks two
sub-sections: a **Runtime** card on top (live state, read-only) and a
**Configuration** card below (settings, gated by manage access).

```
┌────────────────┬──────────────────────────────┐
│  ⚙ Queue       │   ┌──────────────────────┐   │
│  💾 Cache      │   │  Queue Runtime       │   │
│                │   │  (live job counts)   │   │
│                │   └──────────────────────┘   │
│                │   ┌──────────────────────┐   │
│                │   │  Queue Configuration │   │
│                │   └──────────────────────┘   │
└────────────────┴──────────────────────────────┘
```

## Tab Registration

Plugins register a tab as an extension into `InfrastructureTabsSlot`. The
slot's metadata contract carries the tab descriptor (label, icon, access,
order); the slot's render-time context carries `canUpdate`.

```typescript
import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { InfrastructureTabsSlot } from "@checkstack/infrastructure-common";
import { pluginMetadata, queueAccess } from "@checkstack/queue-common";
import { QueueInfrastructureTab } from "./components/QueueInfrastructureTab";
import { Gauge } from "lucide-react";

export const queuePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  extensions: [
    createSlotExtension(InfrastructureTabsSlot, {
      id: "queue.infrastructure.tab",
      component: QueueInfrastructureTab, // receives { canUpdate: boolean }
      metadata: {
        label: "Queue",
        icon: Gauge,
        readAccess: queueAccess.settings.read,
        manageAccess: queueAccess.settings.manage,
        order: 10,
      },
    }),
  ],
});
```

### Slot contract

| Member | Type | Description |
|---|---|---|
| `metadata.label` | `string` | Display label in the tab bar |
| `metadata.icon` | `React.ComponentType<{ className?: string }>` | Icon in the tab bar |
| `metadata.readAccess` | `AccessRule` | Required to render this tab at all |
| `metadata.manageAccess` | `AccessRule` | Required to modify settings; surfaced as `canUpdate` |
| `metadata.order` | `number?` | Sort order in the tab bar (lower = first) |
| `component` | `React.ComponentType<{ canUpdate: boolean }>` | Tab body |

## Per-Tab Access Control

The shell evaluates each registered tab's `readAccess` rule against the
current user. Only tabs the user has permission to view are rendered. The
`manageAccess` rule is forwarded as `canUpdate` to the tab body.

If the user has no access to any tab, the page shows "Access Denied".

## Tab Body Convention

A tab body should stack a Runtime sub-section on top and a Configuration
sub-section below. The Runtime card is read-only and reflects live state
(typically a polled query). The Configuration card mirrors the existing
plugin settings form and respects `canUpdate`.

```typescript
import type { InfrastructureTabContext } from "@checkstack/infrastructure-common";
import { QueueRuntimePanel } from "./QueueRuntimePanel";
import { QueueConfigTab } from "./QueueConfigTab";

export const QueueInfrastructureTab = ({ canUpdate }: InfrastructureTabContext) => (
  <div className="space-y-6">
    <QueueRuntimePanel />
    <QueueConfigTab canUpdate={canUpdate} />
  </div>
);
```

## Surfacing Runtime State

Both Queue and Cache expose a runtime endpoint:

- **Queue** — `getStats` returns `{ pending, processing, completed, failed, scope }`.
  `listJobs({ state, offset, limit })` returns
  `{ items: JobSummary[], total, hasMore }` for the Active / Recent failed /
  Recent completed tables. Pagination is offset-based; `total` is `null`
  when the backend can't compute it cheaply, and the UI uses `hasMore` to
  drive the next button. Payloads are deliberately omitted — they may
  carry secrets, so showing them needs a separate manage-access gate.
- **Cache** — `getRuntimeStats` returns the active provider id plus
  `{ keyCount, sizeBytes, hits, misses, scope }`. Each numeric field is
  nullable; backends that can't report a metric cheaply (e.g. remote caches
  without a cheap stats command) return `null`. The UI renders `null` as `—`.
  `listEntries({ offset, limit, sortBy: "biggest" | "newest" })` returns
  `{ supported, items: CacheEntrySummary[], total, hasMore }`
  (key, byteSize, expiresAt — no values). Backends without affordable
  enumeration return `supported: false`.

### Aggregation across multiple queues

`QueueManager.listJobs` is offset-paginated across the queue set: it
over-fetches `[0, offset+limit)` from each underlying queue, merge-sorts,
then slices the requested window. This keeps the common single-queue case
free of overhead while keeping multi-queue deployments correctly ordered.
Deeply paginated requests (large `offset`) are wasteful by design — the UI
caps `limit` at 200 per request and most users never page beyond the first
few pages.

Cache backends opt in by implementing the optional `getStats?` and
`listEntries?` methods on `CacheProvider`. The in-memory backend is the
reference impl. `Queue<T>.listJobs` is **required**: every queue plugin
must implement it.

## Horizontal Scaling: scope flag

Both `QueueStats` and `CacheStats` carry a `scope: "instance" | "cluster"`
field. In-memory backends report `"instance"` (their state lives in the
local process); Redis-backed queues/caches report `"cluster"` (state is
shared across replicas).

When `scope === "instance"`, the runtime panel shows an
`<InstanceScopeBanner>` above the metrics warning that the figures reflect
the responding replica only and recommending a clustered backend.

`QueueManager.getAggregatedStats` reduces conservatively: any queue
reporting `"instance"` causes the aggregate to also report `"instance"`,
since cluster-wide accuracy can't be claimed if any underlying queue is
local-only.
