---
title: "Alert Silencing"
description: "How the `suppressNotifications` flag on incidents and maintenances filters notification dispatch — which read sites honour it, which dispatch paths it does NOT cover, and the active-only operational contract."
---

# Alert Silencing

Checkstack lets operators silence notifications for systems that already have a
known disruption so on-call channels are not flooded with redundant alerts.
The mechanism is intentionally narrow — a boolean column on each incident or
maintenance record, consulted by a fixed set of dispatch paths.

## The contract

Setting `suppressNotifications = true` on an **active** incident or maintenance
silences notifications dispatched from the read sites listed below **for
systems associated with that incident or maintenance**.

- **Incidents** are "active" when `status != "resolved"`. Any of
  `investigating`, `identified`, `fixing`, or `monitoring` qualifies. Schema:
  [`core/incident-backend/src/schema.ts`](https://github.com/enyineer/checkstack/blob/main/core/incident-backend/src/schema.ts).
- **Maintenances** are "active" when `status == "in_progress"`. Schedules in
  `scheduled` or `completed` do not silence. Schema:
  [`core/maintenance-backend/src/schema.ts`](https://github.com/enyineer/checkstack/blob/main/core/maintenance-backend/src/schema.ts).

The check is one query per record type per dispatch attempt; cost is constant
per affected system.

## Write path

Two editor surfaces toggle the flag:

- `IncidentEditor` (frontend) → `createIncident` / `updateIncident` on the
  incident-common contract.
- `MaintenanceEditor` (frontend) → `createMaintenance` / `updateMaintenance`
  on the maintenance-common contract.

Both surface the boolean as a labelled "Suppress notifications" toggle. No
other path mutates the column.

## Read sites (silenced)

Two dispatch loops consult the silencing flag before sending:

1. **Healthcheck queue executor** —
   [`core/healthcheck-backend/src/queue-executor.ts`](https://github.com/enyineer/checkstack/blob/main/core/healthcheck-backend/src/queue-executor.ts).
   On every health-state transition for a system, the executor calls
   `maintenanceClient.hasActiveMaintenanceWithSuppression({ systemId })`
   first, then
   `incidentClient.hasActiveIncidentWithSuppression({ systemId })`. If either
   returns `suppressed: true`, the executor logs a debug line and returns
   without firing the notification.
2. **Dependency notifications** —
   [`core/dependency-backend/src/notifications.ts`](https://github.com/enyineer/checkstack/blob/main/core/dependency-backend/src/notifications.ts).
   When an upstream system state change would cascade alerts to downstream
   dependents, the dispatcher checks the upstream's maintenance and incident
   suppression. If the upstream is silenced, the cascade is skipped for all
   downstreams in that batch.

If the suppression check itself errors (network blip, etc.), both sites log a
warning and **proceed with the notification** — silencing is a best-effort
filter, not a hard gate that can swallow alerts when the lookup fails.

## What silencing does NOT cover

Silencing is read-path filtering: it only applies where a dispatcher explicitly
calls `hasActiveIncidentWithSuppression()` or `hasActiveMaintenanceWithSuppression()`.
The following dispatch paths bypass it by design:

- **Direct notification dispatch from other plugins** that call
  `notificationClient.notifyForSubscription(...)` (or the underlying router)
  without first consulting the silencing check. Plugin authors that want
  their dispatches to honour silencing must call the maintenance and incident
  S2S endpoints themselves.
- **Incident lifecycle notifications** about the incident itself — created,
  status-changed, resolved updates dispatched by `incident-backend` are
  intentionally always sent. Silencing only suppresses the health-state and
  dependency-cascade noise that an *already-reported* incident would create;
  it does not silence the incident's own update timeline.
- **Manual or ad-hoc notifications** triggered outside the healthcheck and
  dependency-notification loops (operator-initiated messages, integration
  webhooks, etc.).

If you create a silencing record and expect a particular channel to fall
silent but it keeps firing, the dispatcher for that channel almost certainly
does not consult the silencing check. File an issue with the dispatch site
and we can extend coverage.

## Operational notes

Silencing is **active-only**. Resolving an incident (`status = "resolved"`) or
ending a maintenance window (transitioning out of `in_progress`) removes the
filter immediately — the next dispatch attempt sees the record as inactive
and notifications resume without any extra action.

There is no scheduled silencing — you cannot pre-arm a silencing window for a
future incident. Maintenances do double as scheduling primitives, but
silencing only kicks in once the maintenance is `in_progress`.

Silencing is per-system. An incident or maintenance attached to multiple
systems silences each of those systems independently. A system not associated
with an active silenced record is unaffected, even if a sibling system on the
same dependency graph is silenced.
