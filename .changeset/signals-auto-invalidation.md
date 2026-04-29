---
"@checkstack/signal-common": minor
"@checkstack/signal-backend": minor
"@checkstack/signal-frontend": minor
"@checkstack/frontend-api": minor
"@checkstack/frontend": minor
"@checkstack/anomaly-common": minor
"@checkstack/announcement-common": minor
"@checkstack/dependency-common": minor
"@checkstack/healthcheck-common": minor
"@checkstack/incident-common": minor
"@checkstack/integration-common": minor
"@checkstack/maintenance-common": minor
"@checkstack/notification-common": minor
"@checkstack/queue-common": minor
"@checkstack/satellite-common": minor
"@checkstack/slo-common": minor
"@checkstack/announcement-frontend": patch
"@checkstack/dashboard-frontend": patch
"@checkstack/dependency-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/satellite-frontend": patch
"@checkstack/slo-frontend": patch
---

Centralize realtime cache invalidation: signals now carry their owning `pluginId` end-to-end, and a single `SignalAutoInvalidator` mounted near the React Query client invalidates `[[pluginId]]` for every incoming signal automatically.

**Breaking change to `createSignal`** (`@checkstack/signal-common`): the factory now takes a single object argument with `pluginMetadata`, `event`, and `payloadSchema`. The signal id is constructed as `${pluginMetadata.pluginId}.${event}` and the resulting `Signal` carries a `pluginId` field. The `SignalMessage` wire envelope and `ServerToClientMessage` `signal` variant gained a `pluginId` field so the frontend can route invalidations without parsing the id.

```ts
// Before
export const ANOMALY_STATE_CHANGED = createSignal(
  "anomaly.state_changed",
  z.object({ ... }),
);

// After
export const ANOMALY_STATE_CHANGED = createSignal({
  pluginMetadata,
  event: "state_changed",
  payloadSchema: z.object({ ... }),
});
```

**New plugin field**: `FrontendPlugin.foreignSignals?: Signal<unknown>[]` lets a plugin opt its `[[pluginId]]` cache into invalidation when another plugin's signal fires (e.g. `dependency-frontend` declares `[SYSTEM_STATUS_CHANGED]` because dependency payloads embed system status). Same-plugin signals must NOT be listed — they are always auto-invalidated.

**Removed boilerplate**: per-component `useSignal(X, () => refetch())` and `useSignal(X, () => queryClient.invalidateQueries(...))` calls have been removed across `incident-frontend`, `maintenance-frontend`, `healthcheck-frontend`, `slo-frontend`, `dependency-frontend`, `satellite-frontend`, `announcement-frontend`, `notification-frontend`, and `dashboard-frontend`. The `NotificationBell` unread count is now derived directly from the `getUnreadCount` query (auto-invalidated) instead of a local state mirror.

**User-visible bug fix**: the system detail page anomaly widget (`SystemAnomalyWidget`) now updates in real-time when anomalies change, with no per-widget signal subscription required. The dashboard status page also stays fresh on `ANOMALY_STATE_CHANGED`, `ANOMALY_BASELINE_UPDATED`, and `ANOMALY_TREND_DETECTED`.

UI-state consumers that legitimately need a `useSignal` (the dashboard activity terminal, the queue lag alert, and the rolling-preset date refresh in `useHealthCheckData`) keep their handlers; the auto-invalidator runs alongside them.
