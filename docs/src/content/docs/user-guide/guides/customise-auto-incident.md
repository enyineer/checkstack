---
title: "Build auto-incident automations"
description: "Auto-incident is automation-driven - build your own automations that open and close incidents from health state and flapping."
---

Checkstack does not open or close incidents for you out of the box. Opening an incident when a system stays unhealthy, closing it after recovery, and reacting to flapping all ship as ordinary automations that you author, edit, disable, or extend. This guide shows the building blocks and two recipes you can copy.

## What changed

Earlier versions hardcoded auto-incident behaviour driven by each health-check assignment's notification policy (sustained-unhealthy duration, auto-close cooldown, maintenance suppression). That path, and the automatic seeding that briefly replaced it, are gone. Auto-incidents are now entirely yours to build: nothing is created automatically, so you opt in exactly where you want it.

The health-check plugin still emits the signals you build on:

- `healthcheck.system_degraded` / `healthcheck.system_healthy` - the per-system aggregated health changed.
- `healthcheck.system_health_changed` - every aggregated-health transition (carries `previousStatus` / `newStatus`). Combine with a trigger `window:` to detect flapping (`N transitions in M minutes`, per system) - see the recipe below.

> [!TIP]
> To keep one open incident per system, set `dedupe_open_for_system: true` on the `incident.create` action. When on, `incident.create` reuses an existing open incident on the system instead of opening a duplicate, so several failing checks fold into a single incident.

## Recipes

### Sustained unhealthy

Open an incident after a system has been degraded for a while, then resolve it once it recovers.

```yaml
triggers:
  - event: healthcheck.system_degraded
    filter: 'trigger.payload.systemId == "payments-api"'
    for: { minutes: 30 }                # wait 30 min of continuous degradation
conditions:
  - "!health.system.in_maintenance"     # skip while in a maintenance window
mode: single
concurrency_scope: context_key          # one in-flight run per system
actions:
  - id: open_incident
    action: incident.create
    config:
      severity: critical
      systemIds: ["{{ trigger.payload.systemId }}"]
      suppressNotifications: true       # silence channel spam while open
      dedupe_open_for_system: true      # reuse the system's open incident
  - id: await_recovery
    wait_until:
      condition:
        and:
          - "health.system.status == 'healthy'"
          - "health.system.in_status_since | older_than(30 | minutes)"
  - id: resolve_incident
    action: incident.resolve            # consumes the incident opened above
```

The trigger's `for:` dwell re-confirms the system is still unhealthy after the duration before opening (a recovery within the window cancels it). After opening, the run waits until the system has been healthy continuously for the cooldown, then resolves the same incident. `concurrency_scope: context_key` with `mode: single` keeps one in-flight run per system, so a flapping system never stacks duplicate incidents.

### Flapping

React to flapping: open an incident when a system flips in and out of unhealthy too often. Flapping is the trigger `window:` rate gate over the raw `system_health_changed` change event, filtered to unhealthy transitions - no dedicated flapping event.

```yaml
triggers:
  - event: healthcheck.system_health_changed
    id: flapping
    filter: 'trigger.payload.newStatus != "healthy"'   # count unhealthy transitions
    window:
      count: 3        # transitions that count as flapping
      minutes: 60     # sliding window the transitions are counted over
      refire: once    # fire on the crossing edge, not every subsequent transition
conditions:
  - "!health.system.in_maintenance"
actions:
  - id: open_incident
    action: incident.create
    config:
      severity: critical
      systemIds: ["{{ trigger.payload.systemId }}"]
      dedupe_open_for_system: true      # reuse the system's open incident
```

The engine records each qualifying transition in a durable window log and counts the rows within the trailing window, per system. `refire: once` opens an incident on the crossing edge (the 3rd transition) and re-arms as old transitions age out, so a flapping system pages once rather than on every subsequent flip. The threshold lives next to the automation that reacts to it - there is no per-check policy to keep in sync. Flapping is per-SYSTEM (the aggregated health), not per-check.

## Customising

Open **Automations** and build or edit these like any other automation:

- Change the dwell or cooldown with the duration widgets on the trigger and the `wait_until` card.
- Add quiet-hours routing with a `time` condition, or escalate via a `notification.send` action.
- Drop auto-close by omitting the `wait_until` + `resolve` actions (the incident then stays open until resolved manually).
- Require a different severity, add a Jira ticket, post to Slack - compose any registered actions.
- Turn `dedupe_open_for_system` off on an `incident.create` if you want a separate incident per occurrence instead of one shared per system.

> [!NOTE]
> One open incident per system is preserved by the `dedupe_open_for_system` flag on the `incident.create` action. The first transition to cross a threshold opens the incident; other sustained or flapping signals on the same system reuse it. Remove the flag if you prefer a separate incident per occurrence.
