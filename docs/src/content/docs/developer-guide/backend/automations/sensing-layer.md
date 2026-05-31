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
| `health.system.transitions_in_window` | number | Status changes in the trailing window (generalized flapping count) |
| `health.system.transition_window_minutes` | number | The window (minutes) `transitions_in_window` was counted over |
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

A trigger can declare a `for:` dwell - "fire only if the matched state still holds after this duration". This is the precise, event-driven dwell that gates a trigger on sustained state, and it is restart-safe.

```yaml
triggers:
  - event: healthcheck.system_degraded
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

- When the trigger fires and its `filter` passes, the engine arms a row in `automation_dwell_timers` (unique on `(automationId, triggerId, contextKey)`), snapshotting the system's current status, and enqueues an `automation-dwell` wake job with the matching delay. No run starts yet. Arming is idempotent: a re-fire while the dwell is still armed PRESERVES the original deadline rather than pushing it, so the window measures "continuously matched since first arm" (HA semantics). This is essential for continuously-firing triggers like a level-triggered `numeric_state` - pushing the deadline on every check would mean it never elapses. A genuine recover-then-recur deletes the row first (re-confirm / inverse-cancel), so a fresh window starts then.
- At expiry the dwell re-confirms the system is STILL in the status it was in when armed (via the health-state provider). Only then does it evaluate the automation's pre-run conditions and start the run. A recovery within the window therefore cancels the pending fire even without an explicit inverse event.
- Cancellation is DB-side: deleting the dwell row makes the queue job no-op when it pops (queue jobs are not cancellable). A state-change event that contradicts an armed dwell (e.g. `system.healthy` after a `system.degraded` dwell on the same system) eagerly deletes the row.

> [!IMPORTANT]
> The dwell row is the source of truth; the queue job is just the wake signal. If the job is lost (process restart, queue backend loss), the stalled sweeper catches the expired row and fires it. Both paths are idempotent via delete-on-fire, so a dwell fires at most once.

## numeric_state trigger

The built-in `numeric_state` trigger fires off `healthcheck.check.completed` when a numeric field crosses an `above` / `below` threshold. Pair it with a trigger-level `for:` for "above X for Y minutes".

```yaml
triggers:
  - event: automation.numeric_state
    config:
      field: p95LatencyMs      # or latencyMs, or collectors.<id>.<field>
      above: 500
    for: { minutes: 10 }
actions:
  - action: notification.send
    config: { title: "p95 latency high", body: "{{ trigger.payload.systemId }}" }
```

- `field` supports `latencyMs` (top-level), `p95LatencyMs`, and dotted collector paths like `collectors.http.responseTimeMs` (resolved under `result.metadata`).
- `above` / `below` are strict bounds; at least one is required. With both, the value must fall in the open band between them.
- The threshold is enforced per-automation by a structured config gate that runs before the operator's template `filter` - so the trigger only fires for automations whose `above` / `below` the completed check actually crossed.

> [!NOTE]
> v1 is level-triggered: it fires on every completed check whose field is past the threshold. Use `mode: single` and/or a `for:` dwell to avoid alert storms - false-to-true edge de-duplication is a later refinement.
>
> With a `for:` dwell, the window is "continuously above the threshold since first arm" only to the resolution of the cancel signals: a brief dip below the threshold *within* the window is not detected, because `numeric_state` only emits above-threshold events and so produces no below-threshold cancel. The dwell still re-confirms current health status at expiry (so a recovered system won't fire), but precise mid-window numeric edge-cancel is a later refinement. For a true "below threshold cancels" window, model recovery as a separate inverse trigger/automation.

## Flapping and the windowed transition count

> [!TIP]
> The simplest flapping rule is the trigger `window:` rate gate over the raw `healthcheck.system_health_changed` change event, filtered to unhealthy transitions: `window: { count: 3, minutes: 60, refire: once }`. The engine counts qualifying occurrences in a durable window log - no pre-derived flapping event, no scope field. See [the primitives reference](/checkstack/developer-guide/backend/automations/primitives/#flapping-detection-windowed-transition-count).

For rules that need the count as a NUMBER in scope (e.g. to branch a `choose` on how badly a system is flapping, or to combine with other conditions), the health provider also folds a windowed transition count into scope. `health.system.transitions_in_window` is the number of aggregate status changes for the system over the trailing window; the window defaults to 60 minutes and is set per-automation via the top-level `state_window_minutes`. Counting all aggregate transitions (not just unhealthy) is a superset of the unhealthy-transition flapping count.

Author such a rule as a `numeric_state` condition over that field - no new condition variant, no editor change:

```yaml
triggers:
  - event: healthcheck.system_health_changed
state_window_minutes: 30
conditions:
  - numeric_state:
      value: "health.system.transitions_in_window"
      above: 4          # 5+ status changes in the last 30 min
actions:
  - action: incident.create
    config: { title: "{{ trigger.payload.systemId }} is flapping", severity: warning }
```

> [!NOTE]
> The count comes from the `health_check_state_transitions` table (Phase 13), which records every aggregate transition. It is pre-resolved into scope once per evaluation (the template engine can't query), so the condition reads it as plain data.

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

## Structured conditions

Beyond raw template strings and the `and` / `or` / `not` combinators, conditions support three typed variants. Each evaluates over the pre-resolved scope plus a fresh `now` (the `time` variant recomputes `now` per evaluation - never the frozen scope timestamp). The raw template string stays the escape hatch for anything these don't cover.

> [!TIP]
> In the visual builder, the condition kind selector offers "numeric state", "time of day", and "system state" alongside expression / and / or / not. Each renders dedicated widgets (an operator dropdown + threshold for numeric, `TimeOfDayInput` + weekday toggles + timezone for time, a status dropdown + a `DurationInput` dwell for state). A trigger card also has a `for:` dwell toggle with a `DurationInput`. The visual and YAML views round-trip losslessly, so anything authored in one is editable in the other.

### numeric_state

Compare a numeric `value` (a literal number, or a template/path string resolved against scope) to `above` / `below` bounds.

```yaml
conditions:
  - numeric_state:
      value: "health.system.p95_latency_ms"
      above: 500
```

### time

On-call / quiet-hours gating. `after` / `before` are `HH:mm` (24h) local to `timezone` (IANA, defaults to UTC); `weekday` is a list of `0`-`6` (Sunday = 0). An `after` greater than `before` is treated as an overnight window wrapping midnight.

```yaml
conditions:
  - time:
      after: "22:00"
      before: "06:00"
      weekday: [1, 2, 3, 4, 5]
      timezone: "Europe/Berlin"
```

### state

A condition-side dwell: true when `entity` (a system id) is in `status`, optionally held for at least `for`. It reads the pre-resolved `health.systems[entity].in_status_for_ms` - no new timer, it reads the duration the provider already computed.

```yaml
conditions:
  - state:
      entity: "payments-api"
      status: unhealthy
      for: { minutes: 30 }
```

> [!NOTE]
> The system referenced by a `state` condition's `entity` must be resolved into scope - it is the trigger's context system by default, or listed in the automation's `uses_state`.

## wait_until action

`wait_until` suspends a running automation until a condition becomes true, with an optional timeout. It is the condition counterpart to `wait_for_trigger` (which waits for an *event*): instead of waiting for something to happen, it waits for live state to satisfy a condition. It is fully reactive - the suspended run is woken by a relevant entity change, never re-checked on a timer.

```yaml
actions:
  - action: incident.create
    config: { title: "{{ trigger.payload.systemName }} down", severity: critical }
  - wait_until:
      condition: "health.system.status == 'healthy'"
      timeout_seconds: 3600       # wait up to 1h
      continue_on_timeout: true   # default; false = fail the run on timeout
  - action: incident.resolve
    config: { incidentId: "{{ artifacts.incident.id }}" }
```

- `condition` accepts any condition shape - a template string or a structured `numeric_state` / `time` / `state` variant.
- If the condition is ALREADY true when reached, the run continues inline without suspending.
- Otherwise the run suspends with a durable `kind: "until"` wait lock carrying the condition + timeout policy. At suspend time the engine extracts the `state.*` refs the condition reads and inserts wake-index rows keyed by `${kind}:${id}`, plus a single durable timeout timer at the deadline. A relevant entity change wakes the run, re-enriches scope, and re-evaluates the full condition: true resumes the run; the timeout deadline resumes (continue) or fails per `continue_on_timeout` (default true, matching HA's `wait_template`); still-false stays suspended.
- Works nested inside `choose` / `parallel` / `repeat` - the engine resumes through the same remainder mechanism as every other suspend.

> [!IMPORTANT]
> Like every suspend, `wait_until` survives a restart: the wait lock + wake-index rows are the source of truth, an `ENTITY_CHANGED` is the wake signal, and the stalled sweeper applies the timeout policy as a backstop if the timer job is lost. Resumes take the per-run advisory lock, so a wake and a sweep can't double-resume. The `poll_seconds` field is now inert (waits are woken by change, not polled). For the full mechanism, see [the reactive dispatch pipeline](/checkstack/developer-guide/backend/automations/reactive-dispatch/).
