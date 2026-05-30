---
title: "Customise auto-incident"
description: "Auto-incident is now automation-driven - read, edit, and extend the default automations that open and close incidents from health state."
---

Checkstack no longer hardcodes auto-incident behaviour. Opening an incident when a system stays unhealthy, closing it after recovery, and reacting to flapping all ship as ordinary automations you can read, edit, disable, or extend. This guide explains the default automations and how to customise them.

## What changed

Previously a background path opened and closed incidents based on each health-check assignment's notification policy (sustained-unhealthy duration, flapping threshold, auto-close cooldown, maintenance suppression). That path is gone. On upgrade, Checkstack seeds equivalent automations whose thresholds mirror your existing policy exactly, so alerting behaviour - including how many incidents you get - is preserved.

Auto-incidents remain one open incident per system. A system with several failing checks still gets a single incident: whichever check crosses its threshold first opens it, and the others reuse it. This works via an opt-in `dedupe_open_for_system` flag on the `incident.create` action (set on the seeded automations) - when on, `incident.create` reuses an existing open incident on the system instead of opening a duplicate.

> [!NOTE]
> The migration is idempotent and threshold-preserving: each seeded automation is tagged so re-runs are no-ops, and every notification-policy value maps 1:1 onto the automation (duration to the trigger dwell, cooldown to the recovery wait, suppression to the incident's notification flag, maintenance to a pre-run condition, and per-system dedup to the `dedupe_open_for_system` flag).

## The default automations

For each assignment with auto-incident enabled, two automations are seeded.

### Sustained unhealthy

```yaml
triggers:
  - event: healthcheck.system_degraded
    filter: 'trigger.payload.systemId == "payments-api"'
    for: { minutes: 30 }          # sustainedUnhealthyTrigger.durationMinutes
conditions:
  - "!health.system.in_maintenance"   # skipDuringMaintenance
mode: single
concurrency_scope: context_key        # one in-flight run per system
actions:
  - id: open_incident
    action: incident.create
    config:
      severity: critical
      systemIds: ["{{ trigger.payload.systemId }}"]
      suppressNotifications: true      # useNotificationSuppression
  - id: await_recovery
    wait_until:
      condition:
        and:
          - "health.system.status == 'healthy'"
          - "health.system.in_status_since | older_than(30 | minutes)"  # autoCloseAfterMinutes
  - id: resolve_incident
    action: incident.resolve           # consumes the incident opened above
```

The trigger's `for:` dwell re-confirms the system is still unhealthy after the duration before opening (a recovery within the window cancels it). After opening, the run waits until the system has been healthy continuously for the cooldown, then resolves the same incident. `concurrency_scope: context_key` with `mode: single` keeps one in-flight run per system, so a flapping system never stacks duplicate incidents.

### Flapping

```yaml
triggers:
  - event: healthcheck.flapping_detected
    filter: 'trigger.payload.systemId == "payments-api" && trigger.payload.configurationId == "..."'
conditions:
  - "!health.system.in_maintenance"
actions:
  - id: open_incident
    action: incident.create
    config:
      severity: critical
      systemIds: ["{{ trigger.payload.systemId }}"]
      dedupe_open_for_system: true   # reuse the system's open incident
```

Flapping detection itself still runs in the health-check executor and emits `healthcheck.flapping_detected` whenever a check crosses its `N transitions in M minutes` threshold. The automation just reacts to it. With `dedupe_open_for_system`, flapping on any check folds into the same open incident as a co-occurring sustained outage rather than opening a second.

## Customising

Open **Automations** and edit the seeded automation like any other:

- Change the dwell or cooldown with the duration widgets on the trigger and the `wait_until` card.
- Add quiet-hours routing with a `time` condition, or escalate via a `notification.send` action.
- Disable auto-close by removing the `wait_until` + `resolve` actions (the incident then stays open until resolved manually).
- Require a different severity, add a Jira ticket, post to Slack - compose any registered actions.
- Turn `dedupe_open_for_system` off on an `incident.create` if you want a separate incident per occurrence instead of one shared per system.

> [!NOTE]
> One open incident per system is preserved by the `dedupe_open_for_system` flag on the seeded `incident.create` actions. The first check to cross its threshold opens the incident; other sustained or flapping checks on the same system reuse it. Remove the flag (or trigger on a single check) if you prefer one incident per check.
