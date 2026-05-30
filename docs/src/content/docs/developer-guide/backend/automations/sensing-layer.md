---
title: "Automation sensing layer"
description: "Live health state in template scope, pure duration filters, and the filter extension point that power duration-aware automation rules."
---

The sensing layer lets an automation read live system health and reason about durations - "open an incident if a system stays unhealthy for 30 minutes", "page only when latency has been high for 10 minutes". The template engine is strictly synchronous with no call syntax, so live state is never queried inline. Instead it is pre-resolved into scope once per evaluation and read as plain data.

## State in scope

Before a run starts (and again on resume, and at the trigger-gate sites), the engine resolves live health state and folds it into scope under a `health` namespace. Templates and conditions then read it as ordinary data.

| Path | Type | Meaning |
|------|------|---------|
| `health.system` | object | State of the system named by the trigger's context key |
| `health.system.status` | `"healthy" \| "degraded" \| "unhealthy"` | Aggregate status |
| `health.system.in_status_since` | string \| null | ISO timestamp the system entered its current status |
| `health.system.in_status_for_ms` | number | Milliseconds in the current status |
| `health.system.latency_ms` | number | Newest run latency |
| `health.system.avg_latency_ms` | number | Windowed average latency |
| `health.system.p95_latency_ms` | number | Windowed p95 latency |
| `health.system.success_rate` | number | Windowed success rate in [0, 1] |
| `health.system.in_maintenance` | boolean | Whether the system is in an active maintenance window |
| `health.systems[<id>]` | object | State of any system listed in `uses_state` |

### Resolution policy

By default the engine resolves only the system named by the trigger's context key (one batched query, the common single-system case). To reason about other systems, list their ids in the automation's `uses_state` field; they surface under `health.systems[<id>]`.

```yaml
triggers:
  - event: time.interval
    config: { seconds: 60 }
uses_state:
  - "payments-api"
  - "checkout-api"
conditions:
  - "health.systems['payments-api'].status == 'unhealthy'"
```

> [!NOTE]
> Resolution is fail-open. A missing health-check client or a provider error yields an empty `health` namespace and a warning, so a healthcheck outage never wedges unrelated automations. The resolved set is bounded; truncation is logged, never silent.

## Trigger `for:` dwell

A trigger can declare a `for:` dwell - "fire only if the matched state still holds after this duration". This is the precise, event-driven counterpart to the poll-path condition above, and it is restart-safe.

```yaml
triggers:
  - event: healthcheck.system.degraded
    for: { minutes: 30 }   # only if still in the same status after 30 min
actions:
  - action: incident.create
    config:
      title: "{{ trigger.payload.systemName }} is critical"
      severity: critical
      systemIds: ["{{ trigger.payload.systemId }}"]
```

`for:` accepts a single-unit duration (`{ seconds }`, `{ minutes }`, or `{ hours }`) or `{ template }` rendering to a number of seconds.

How it works:

- When the trigger fires and its `filter` passes, the engine arms (or re-arms) a row in `automation_dwell_timers`, snapshotting the system's current status, and enqueues an `automation-dwell` wake job with the matching delay. No run starts yet. A re-fire pushes the deadline rather than stacking timers (unique on `(automationId, triggerId, contextKey)`).
- At expiry the dwell re-confirms the system is STILL in the status it was in when armed (via the health-state provider). Only then does it evaluate the automation's pre-run conditions and start the run. A recovery within the window therefore cancels the pending fire even without an explicit inverse event.
- Cancellation is DB-side: deleting the dwell row makes the queue job no-op when it pops (queue jobs are not cancellable). A state-change event that contradicts an armed dwell (e.g. `system.healthy` after a `system.degraded` dwell on the same system) eagerly deletes the row.

> [!IMPORTANT]
> The dwell row is the source of truth; the queue job is just the wake signal. If the job is lost (process restart, queue backend loss), the stalled sweeper catches the expired row and fires it. Both paths are idempotent via delete-on-fire, so a dwell fires at most once.

## Duration filters

Duration helpers are pure, synchronous template filters - transforms over already-resolved values, never database calls. They compute against real time at call time, so "now" is fresh per evaluation rather than the frozen run-start timestamp.

| Filter | Form | Result |
|--------|------|--------|
| `minutes` | `30 \| minutes` | A number of minutes as milliseconds |
| `hours` | `2 \| hours` | A number of hours as milliseconds |
| `duration_since` | `iso \| duration_since` | Milliseconds elapsed since an ISO timestamp |
| `older_than` | `iso \| older_than(thresholdMs)` | True when the timestamp is at least `thresholdMs` in the past |

A duration-aware condition reads the pre-resolved `in_status_since` and compares it with the duration filters:

```ts
// "unhealthy for at least 30 minutes"
health.system.status == 'unhealthy' && (health.system.in_status_since | older_than(30 | minutes))
```

> [!TIP]
> Filter arguments may themselves be pipe expressions, so `older_than(30 | minutes)` is valid: the argument `30 | minutes` evaluates to `1800000` before `older_than` runs. The grammar has no bare function calls - everything flows through the pipe.

`duration_since` returns `0` for null / unparseable input (never negative); `older_than` returns `false` for an unknown timestamp (an unknown age is never "older than" a threshold).

## Filter extension point

Plugins can contribute their own pure filters through `automationFilterExtensionPoint`. Filters MUST be pure and synchronous - no I/O, no async, no database access - because the engine evaluates them inline during rendering.

```ts
import { automationFilterExtensionPoint } from "@checkstack/automation-backend";

const ext = env.getExtensionPoint(automationFilterExtensionPoint);
ext.registerFilter(
  {
    name: "percent",
    signature: "percent(decimals)",
    description: "Format a 0-1 ratio as a percentage string.",
    filter: (value, decimals) => {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return value;
      const d = typeof decimals === "number" ? decimals : 0;
      return `${(n * 100).toFixed(d)}%`;
    },
  },
  pluginMetadata,
);
```

A filter whose name collides with a built-in is skipped with a warning rather than overwriting the built-in.
