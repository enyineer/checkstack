---
title: Incidents
description: A manual record of a real-world outage. You open it, attach systems, post updates, and resolve it. Checkstack does not auto-open incidents.
---

An Incident is the human-driven record of a disruption: someone noticed something is broken, opened an incident, and the team is now coordinating the response. Checkstack tracks the full lifecycle (status, updates, links, affected systems) and keeps the timeline for postmortems. This page describes what incidents are, what they are not, and how they interact with the rest of the platform.

## What an incident is

Each incident has:

- A **title** and an optional **description** to summarise the situation.
- A **status** that moves through the lifecycle below.
- A **severity**: `minor`, `major`, or `critical`.
- A list of **affected systems** (the catalog systems impacted by the disruption).
- A timeline of **status updates** posted as the response progresses.
- Optional **hotlinks** (Jira ticket, runbook, chat thread, ...).
- A **suppress notifications** toggle, covered below.

Incidents live under **Incidents** in the main nav, with a list view, a detail view, and an editor.

## Incidents are manual

> [!IMPORTANT]
> Checkstack does not auto-open incidents from failing health checks. Incidents only exist because someone (or some external system) reported one.
>
> A failing health check changes a system's state, fires notifications, and shows up in the dependency map. It does not create or update incidents. The decision "is this important enough to track as an incident?" stays with operators.

This is a deliberate design choice. Auto-incident creation tends to either spam (one incident per flap) or silently miss the actually-important outages because the upstream signal was the wrong one. Checkstack's view is that the human noticing is part of the workflow.

There are two practical consequences:

1. When a system goes red, you still need to **open an incident** manually if you want one tracked.
2. When an incident is created, you choose which systems to attach. Checkstack does not guess.

If you do want incidents opened automatically, that is opt-in: build an automation on the health signals yourself - see [Build auto-incident automations](/checkstack/user-guide/guides/customise-auto-incident/). Nothing is seeded for you. To create incidents in another tool instead, look at [Integrations](/checkstack/user-guide/concepts/integrations/); the "system unhealthy" event can be forwarded to a webhook or a Jira project that you run on the receiving side.

## The lifecycle

Incidents move through a fixed set of statuses:

```
              open                                              done
   +---------------+   +-----------+   +---------+   +------------+   +----------+
   | investigating |-->| identified|-->| fixing  |-->| monitoring |-->| resolved |
   +---------------+   +-----------+   +---------+   +------------+   +----------+
                                                                          ^
                                                  (any active status) ----+
```

- **investigating**: we know something is wrong, we are still figuring out what.
- **identified**: we know the cause, we are deciding how to fix it.
- **fixing**: we are applying the fix.
- **monitoring**: the fix is deployed, we are watching for recurrence before declaring victory.
- **resolved**: closed. The incident is in the past tense.

An incident is **active** as long as its status is anything other than `resolved`. The status is freely transitionable in the UI; you can skip forward or jump back if the situation regresses (`monitoring` -> `fixing` is fine).

Every status change is recorded as a status update on the timeline. You can also post updates without changing the status (for example, "redeployed the worker pool" while still in `fixing`).

## Affected systems

Attach the catalog systems the incident covers. This drives two things:

- It makes the incident discoverable from the system detail page; anyone looking at a system can see active incidents touching it.
- It scopes notification silencing (covered next).

You can attach systems when opening the incident or any time after.

## Suppress notifications

Active incidents carry a **suppress notifications** toggle. When enabled, the platform silences a defined set of notifications for the systems attached to that incident, for the lifetime of the active incident.

What suppression covers:

- Health-state-change notifications for systems on this incident (the executor checks for an active, suppressed incident before firing).
- Dependency cascade notifications that would otherwise fan out from a system on this incident.

What suppression does *not* cover:

- Notifications about the incident itself (created, status-changed, resolved). Those are the whole point of having an incident; silencing them would defeat the purpose.
- Notifications dispatched from plugins that do not consult the suppression check. Most bundled plugins do, but custom plugins might not.
- Anything outside the healthcheck and dependency notification paths.

Suppression is active-only. The moment you transition the incident to `resolved`, the filter lifts and notifications resume.

> [!TIP]
> The typical pattern: open the incident, attach affected systems, enable Suppress notifications. The team is now reading the incident timeline for updates instead of getting paged on every flap. When the fix is deployed and you transition to `monitoring`, leave suppression on until you mark `resolved`.

For the full read-side contract see the developer-facing [Alert silencing](/checkstack/developer-guide/architecture/alert-silencing/) doc. The operator how-to is [Silence alerts](/checkstack/user-guide/guides/silence-alerts/).

## Severity

Severity is a label, not an automation. The platform does not change behaviour between minor and critical incidents; it is there so your team can filter and report on patterns. Use whatever scheme your team agrees on:

- **minor**: limited impact, no customer effect.
- **major**: real customer impact, but not a full outage.
- **critical**: full outage or data-loss risk.

## Hotlinks

The incident detail page has a **Links** section for free-form URL hotlinks. Common uses:

- The Jira or Linear ticket tracking remediation work.
- The chat thread where responders are coordinating.
- The runbook the responder is following.
- The status page entry the customer-comms team posted.

Hotlinks are just labelled URLs. They do not auto-update from anywhere.

## Incidents and integrations

Incidents emit lifecycle events the integration system can forward externally:

- An incident was created.
- An incident's status changed.
- An incident was resolved.
- A new update was posted.

A webhook subscription on those events can post into Slack, file or update a Jira ticket, page a PagerDuty service, and so on. See [Integrations](/checkstack/user-guide/concepts/integrations/).

## UI tour

| Where to go | What you do there |
|-------------|-------------------|
| **Incidents** (list) | See all incidents, filter by status, severity, or affected system. |
| **Open Incident** | Create a new incident. Set title, description, severity, attach systems. |
| **Incident detail** | Post updates, change status, edit affected systems, manage hotlinks. |
| **System detail** | See the active incidents currently touching this system. |

## Where to go next

- **Hands-on.** Walk through [Open and resolve your first incident](/checkstack/user-guide/guides/open-and-resolve-incident/).
- **Silencing.** Read [Silence alerts](/checkstack/user-guide/guides/silence-alerts/) for the suppress-notifications walkthrough.
- **Planned downtime.** [Maintenances](/checkstack/user-guide/concepts/maintenances/) are the scheduled counterpart to incidents.
- **Forwarding outside.** [Integrations](/checkstack/user-guide/concepts/integrations/) can ship incident events to Slack, Jira, and other tools.
