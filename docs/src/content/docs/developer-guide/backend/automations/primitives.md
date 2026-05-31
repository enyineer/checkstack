---
title: "Automation primitives reference"
description: "Per-primitive reference for every automation building block - control-flow actions plus the sensing-layer triggers, conditions, and actions - each with a runnable YAML example."
---

This page is the canonical per-primitive reference for an automation `definition`. Every action, trigger, and condition is listed with its shape and a runnable YAML snippet. The visual editor and the YAML view round-trip losslessly, so anything here is also editable in the builder. For the runtime semantics behind these shapes, see [the automation platform overview](/checkstack/developer-guide/backend/automations/) and [the sensing layer](/checkstack/developer-guide/backend/automations/sensing-layer/).

## Definition shape

An automation definition is `triggers` + optional `conditions` + ordered `actions`, plus run-control fields. Actions are discriminated by which key is present (`action`, `choose`, `parallel`, `delay`, `repeat`, `variables`, `condition`, `stop`, `wait_for_trigger`, `wait_until`, `sequence`).

```yaml
name: "Page on sustained latency"
mode: single                 # single | parallel | queued | restart
concurrency_scope: context   # automation | context
max_runs: 10                 # queue depth for mode: queued
triggers:
  - event: automation.numeric_state
    config: { field: p95LatencyMs, above: 500 }
    for: { minutes: 10 }
conditions:
  - time:
      after: "08:00"
      before: "20:00"
actions:
  - action: notification.send
    config: { title: "p95 latency high", body: "{{ trigger.payload.systemId }}" }
```

Every action also accepts these shared fields:

- `id` - a stable identifier, used to reference the action's artifacts (`artifacts.<id>.<name>`) and to read it in run logs. Auto-filled if left blank.
- `description` - an optional operator note.
- `enabled` - set to `false` to skip the action without deleting it. Defaults to `true`.
- `continue_on_error` - when `true`, a failure in this action does not halt the run. Defaults to `false`.

> [!TIP]
> In the visual builder, `id`, `description`, and `continue_on_error` live under each action's "Advanced" disclosure so the action's own configuration stays the focus. `enabled` is the toggle on the action card header.

## Control-flow actions

### action

Calls a registered action by its namespaced id (`plugin.action_name`) and renders its templated `config`.

```yaml
actions:
  - action: incident.create
    config:
      title: "{{ trigger.payload.systemName }} is down"
      severity: critical
      systemIds: ["{{ trigger.payload.systemId }}"]
```

### choose

`if` / `elif` / `else` branching. Each clause has a `when` condition and a `sequence` that runs when it is the first matching clause. The optional `else` runs when no clause matches.

```yaml
actions:
  - choose:
      - when: "trigger.payload.severity == 'critical'"
        sequence:
          - action: notification.send
            config: { title: "Critical", body: "Paging on-call" }
      - when: "trigger.payload.severity == 'warning'"
        sequence:
          - action: notification.send
            config: { title: "Warning", body: "FYI" }
    else:
      - action: notification.send
        config: { title: "Info", body: "Logged only" }
```

### parallel

Fans out actions concurrently and waits for all of them. Each branch is itself an action - wrap multi-step branches in a `sequence`.

```yaml
actions:
  - parallel:
      - action: notification.send
        config: { title: "Notify ops" }
      - sequence:
          - action: incident.create
            config: { title: "Investigate", severity: warning }
          - action: notification.send
            config: { title: "Ticket opened" }
```

### sequence

Wraps an ordered list of actions as a single action. Useful as a multi-action branch inside `parallel` / `choose`, or to apply one `id` / `continue_on_error` to a group atomically.

```yaml
actions:
  - sequence:
      id: triage
      continue_on_error: true
      sequence:
        - action: incident.create
          config: { title: "Triage", severity: warning }
        - action: notification.send
          config: { title: "Triage started" }
```

### delay

Sleeps for a fixed or templated number of seconds (max 86400). The run suspends durably and resumes when the delay elapses.

```yaml
actions:
  - delay: { seconds: 300 }            # five minutes
  - delay: { template: "{{ trigger.payload.cooldownSeconds }}" }
```

### repeat

Loops a `sequence` in one of four modes. `repeat.index` is exposed in every mode; `for_each` also exposes `repeat.item`.

- `count` - run the sequence a fixed number of times.
- `for_each` - a template rendering to a JSON array; run once per item.
- `while` - evaluate a condition before each iteration; stop when false.
- `until` - evaluate a condition after each iteration; stop when true.

`while` / `until` accept an optional `max_iterations` (defaults to 1000) as a safety net.

```yaml
actions:
  - repeat:
      count: 3
      sequence:
        - action: notification.send
          config: { title: "Reminder {{ repeat.index }}" }
  - repeat:
      for_each: "{{ trigger.payload.affectedSystems }}"
      sequence:
        - action: incident.create
          config: { title: "{{ repeat.item }} affected", severity: warning }
  - repeat:
      while: "health.system.status != 'healthy'"
      max_iterations: 20
      sequence:
        - wait_until:
            condition: "health.system.status == 'healthy'"
```

### variables

Defines local scoped values for downstream actions. Values can be literals or templates; templates render at execution time and the rendered value is stored under the variable name.

```yaml
actions:
  - variables:
      threshold: 500
      summary: "{{ trigger.payload.systemName }} at {{ trigger.payload.p95 }}ms"
  - action: notification.send
    config: { title: "{{ var.summary }}" }
```

### condition

A mid-run guard. If the condition is false the run halts (unless `continue_on_error: true`). Accepts any condition shape - a template string or a structured variant.

```yaml
actions:
  - condition: "health.system.status == 'unhealthy'"
  - action: incident.create
    config: { title: "Confirmed unhealthy", severity: critical }
```

### stop

Explicitly halts the run, with an optional `reason` and an `error` flag. `error: true` marks the run as failed.

```yaml
actions:
  - choose:
      - when: "health.system.in_maintenance"
        sequence:
          - stop: { reason: "System in maintenance window" }
  - action: incident.create
    config: { title: "Real outage", severity: critical }
```

### wait_for_trigger

Suspends the run until a matching event arrives, with an optional timeout (max 30 days). `context_key` defaults to the triggering event's context key, so a wait inside an `incident.created` run matches the `incident.resolved` event for the same incident.

```yaml
actions:
  - action: incident.create
    config: { title: "Outage", severity: critical }
  - wait_for_trigger:
      event: incident.resolved
      timeout_seconds: 86400
      filter: "{{ trigger.payload.id == artifacts.incident.id }}"
  - action: notification.send
    config: { title: "Resolved within SLA" }
```

### wait_until

Suspends the run until a condition becomes true, woken reactively by a relevant entity change (no polling). The condition counterpart to `wait_for_trigger`. If the condition is already true when reached, the run continues without suspending.

```yaml
actions:
  - action: incident.create
    config: { title: "{{ trigger.payload.systemName }} down", severity: critical }
  - wait_until:
      condition: "health.system.status == 'healthy'"
      timeout_seconds: 3600        # wait up to 1h
      continue_on_timeout: true    # default; false = fail the run on timeout
  - action: incident.resolve
    config: { incidentId: "{{ artifacts.incident.id }}" }
```

> [!NOTE]
> `wait_until` is reactive: at suspend time the engine extracts the `state.*` refs the condition reads and wakes the run when a matching entity change arrives, then re-evaluates the full condition. The `poll_seconds` field is now inert (a wait is no longer re-checked on a timer). See [the reactive dispatch pipeline](/checkstack/developer-guide/backend/automations/reactive-dispatch/).

## Triggers

A trigger is the entry point. Every trigger has an `event`; built-in triggers also take `config`. Optional per-trigger fields: an `id` (a discriminator for `trigger.id` in `choose` clauses), a gating `filter` template, a `for:` dwell, and a `window:` rate gate.

### Event trigger with filter

```yaml
triggers:
  - event: healthcheck.system_degraded
    id: payments_degraded
    filter: "{{ trigger.payload.systemId == 'payments-api' }}"
```

> [!NOTE]
> Health lifecycle events use the underscore trigger ids `healthcheck.system_degraded` / `healthcheck.system_healthy` / `healthcheck.system_health_changed` (the qualified `${pluginId}.${triggerId}`). These are now driven by the reactive `health` entity's change deriver rather than a hook; the event ids are unchanged from an operator's point of view. See [the entity state machine](/checkstack/developer-guide/backend/automations/entity-state-machine/).

### for: dwell

Fire only if the matched state still holds after a duration. Accepts a single-unit duration (`{ seconds }`, `{ minutes }`, `{ hours }`) or `{ template }` rendering to seconds. Restart-safe and idempotent - a re-fire while armed preserves the original deadline.

```yaml
triggers:
  - event: healthcheck.system_degraded
    for: { minutes: 30 }
```

### window: rate gate

Fire only after this trigger has fired (post-`filter`) at least `count` times within the trailing `minutes`, scoped per context key (e.g. per system). The engine records each qualifying occurrence in a durable append log and counts rows within the sliding window:

- `refire: every` (default) fires on every occurrence at/over the threshold - it re-fires while the window stays over threshold, so debounce in the automation (`mode: single` + `for:`) if you want "page once".
- `refire: once` fires only on the crossing edge (when the count first reaches `count`) and re-arms naturally as old occurrences age out of the window and the count re-crosses.

The window gate runs AFTER `filter` (so only qualifying occurrences count) and BEFORE `for:` (so the two can compose). The count is read from shared Postgres, so it is identical on every pod; the single occurrence INSERT happens on the one pod that claims the emission from the work queue.

```yaml
triggers:
  - event: healthcheck.check_failed
    window: { count: 5, minutes: 10 }   # 5 check failures in 10 min, per system
actions:
  - action: incident.create
    config: { title: "{{ trigger.payload.systemId }} failing repeatedly", severity: warning }
```

A single automation covers ALL systems: the count is bucketed per partition key and fires per key, so one automation pages independently for every flapping system without enumerating them. By default the partition is the trigger's built-in context key (`systemId` for health triggers, `incidentId` for incident triggers, and so on).

#### partitionBy

`partitionBy` overrides the dimension the count is bucketed by. It is a bare expression (same flavour as `filter` - no `{{ }}`) evaluated against the trigger scope; the result is coerced to a string and used as the partition key.

```yaml
triggers:
  - event: healthcheck.check_failed
    window:
      count: 5
      minutes: 10
      partitionBy: trigger.payload.severity   # per-severity rate, across all systems
```

- **Omitted (default):** the trigger's built-in context key (e.g. `systemId`) - one window per system. Existing automations are unaffected.
- **An explicit equivalent of the default** is `partitionBy: trigger.payload.systemId`.
- **A composite key** is just an expression: `partitionBy: trigger.payload.systemId + ":" + trigger.payload.checkId` (per system-and-check).
- **Fallback:** if the expression evaluates to null / undefined / empty, OR it fails to evaluate, the gate falls back to the built-in context key rather than counting globally (so a typo never collapses every partition into one bucket). Evaluation errors are logged.

### numeric_state trigger

Fires off a completed health check when a numeric field crosses an `above` / `below` threshold. Pair with `for:` for "above X for Y minutes". `field` supports `latencyMs`, `p95LatencyMs`, and dotted collector paths like `collectors.http.responseTimeMs`.

```yaml
triggers:
  - event: automation.numeric_state
    config:
      field: p95LatencyMs
      above: 500
    for: { minutes: 10 }
```

### Flapping detection (windowed transition count)

Flapping is just the `window:` rate gate over the raw `healthcheck.system_health_changed` change event, filtered to unhealthy transitions. There is no dedicated flapping trigger or hook - healthcheck emits only the raw per-system aggregated-health change, and the engine does the counting. Use `refire: once` so a flapping system pages on the crossing edge rather than on every subsequent transition.

```yaml
triggers:
  - event: healthcheck.system_health_changed
    id: flapping
    filter: 'trigger.payload.newStatus != "healthy"'   # count unhealthy transitions
    window: { count: 3, minutes: 60, refire: once }     # 3 in 60 min, per system
actions:
  - action: incident.create
    config: { title: "{{ trigger.payload.systemId }} is flapping", severity: warning }
```

> [!NOTE]
> Flapping is now PER-SYSTEM (the aggregated `health` entity), not per-check. Trigger `filter` strings are bare expressions (no `{{ }}` wrapper) - the same grammar as a `choose: when` clause.

## Conditions

Conditions are pre-run gates (top-level `conditions`) or mid-run guards (the `condition` action). Beyond raw template strings and the `and` / `or` / `not` combinators, three structured variants are available. The raw template string stays the escape hatch for anything they do not cover.

### Combinators and expressions

```yaml
conditions:
  - and:
      - "health.system.status == 'unhealthy'"
      - or:
          - "trigger.payload.severity == 'critical'"
          - not: "health.system.in_maintenance"
```

### numeric_state condition

Compare a numeric `value` (a literal, or a template/path resolved against scope) to `above` / `below` bounds. With both, the value must fall in the open band between them.

```yaml
conditions:
  - numeric_state:
      value: "health.system.p95_latency_ms"
      above: 500
```

### time condition

On-call / quiet-hours gating. `after` / `before` are `HH:mm` (24h) local to `timezone` (IANA, defaults to UTC); `weekday` is a list of `0`-`6` (Sunday = 0). An `after` greater than `before` is an overnight window wrapping midnight.

```yaml
conditions:
  - time:
      after: "22:00"
      before: "06:00"
      weekday: [1, 2, 3, 4, 5]
      timezone: "Europe/Berlin"
```

### state condition

True when `entity` (a catalog system id) is in `status`, optionally held for at least `for`. Reads the pre-resolved `health.systems[entity].in_status_for_ms` - no new timer.

```yaml
conditions:
  - state:
      entity: "payments-api"
      status: unhealthy
      for: { minutes: 30 }
```

> [!NOTE]
> The system referenced by a `state` condition's `entity` must be resolved into scope - it is the trigger's context system by default, or listed in the automation's `uses_state`. The visual builder backs this field with a live system picker over the catalog, with a manual-entry fallback so an id not yet in the catalog (or a template) still round-trips.
