---
title: Maintenances
description: Scheduled downtime windows that suppress noise during planned work and signal upcoming changes to the team.
---

A Maintenance is a planned-downtime window attached to one or more systems. Unlike an [Incident](/checkstack/user-guide/concepts/incidents/), which records something that broke, a maintenance records something you are going to do (or are doing right now). It also doubles as a notification-suppression mechanism so on-call channels do not light up during expected disruption.

## What a maintenance is

Each maintenance carries:

- A **title** and an optional **description** of what work is planned.
- A **start time** and an **end time** that define the window.
- A **status** that progresses automatically as the window opens and closes.
- A list of **affected systems**.
- A timeline of **status updates** for human-readable progress notes.
- Optional **hotlinks** (change ticket, runbook, chat thread).
- A **suppress notifications** toggle.

Maintenances live under **Maintenances** in the main nav.

## The status windows

A maintenance moves through four statuses, driven by the configured start and end times:

```text
   +-----------+   start_at reached   +-------------+   end_at reached   +-----------+
   | scheduled |--------------------->| in_progress |------------------->| completed |
   +-----------+                      +-------------+                    +-----------+
        |                                   |
        |                                   v
        +-------------+   cancelled       +-----------+
                      +------------------>| cancelled |
                                          +-----------+
```

- **scheduled**: the window is in the future. The maintenance is announced but not yet "live".
- **in_progress**: `start_at` has passed and `end_at` has not. The maintenance is the current state of affairs.
- **completed**: `end_at` has passed without cancellation. The work is over.
- **cancelled**: an operator cancelled the maintenance before or during the window.

Status transitions are automated. A background job evaluates every minute and flips the status the moment the corresponding boundary is crossed. You can also force transitions manually (for example, completing early when work finishes ahead of schedule).

> [!NOTE]
> Maintenances are one-off windows. Checkstack does not bake in a "this maintenance recurs every Sunday at 02:00" concept. If you need recurring downtime windows, drive them from your own scheduler or [GitOps](/checkstack/user-guide/concepts/gitops/) pipeline that creates a new maintenance each time.

## Suppress notifications

Like incidents, maintenances have a **suppress notifications** toggle. The behaviour is intentionally similar, with one important difference: the toggle is only active while the maintenance is `in_progress`. A scheduled maintenance does not pre-arm suppression; the silencing kicks in only when the window opens, and lifts the moment it closes.

When `in_progress` and `suppressNotifications = true`:

- Health-state-change notifications for the maintenance's affected systems are suppressed.
- Dependency cascade notifications from those systems are suppressed.

Notifications about the maintenance itself (started, ending soon, completed) are still delivered. Operators want to know that a window opened and closed even if everything else is silenced.

> [!TIP]
> The typical pattern: create the maintenance in `scheduled` state in advance, with Suppress notifications enabled. Subscribers see the announcement immediately. When the start time is reached, the maintenance moves to `in_progress` and the silencing engages automatically. At end time, it moves to `completed` and notifications resume.

## Interaction with health checks

Maintenances **do not pause** the underlying health checks. The probes still run; the results still flow into history; the platform's evaluator still sees the failures. What changes is the notification fan-out: the platform consults active maintenances before firing health-state-change notifications.

If you want to actually stop a check from running during a maintenance (because the work involves the check target being unreachable in a way that would pollute history), pause the check assignment directly from the system detail page. That is a separate setting from maintenances and is not driven by maintenance status.

## Maintenances vs incidents

Use a maintenance when:

- The disruption is planned.
- You know the start and end times.
- You want to suppress noise for the duration.

Use an incident when:

- Something broke unexpectedly.
- You do not know how long it will last.
- You need to track investigation and remediation steps.

The two can coexist. If a planned maintenance turns into an actual outage that exceeds the window, open an incident for the unexpected portion; the maintenance still records the original planned work.

## Affected systems

Attach the catalog systems the maintenance affects. This drives:

- Discoverability from the system detail page (anyone looking at a system sees upcoming and active maintenances).
- The scope of notification suppression while the maintenance is `in_progress`.

## Where maintenances surface

A maintenance is visible from several places depending on its status:

- **The dashboard** shows a "Planned maintenances" section listing the soonest scheduled (not-yet-started) maintenance windows (up to a small cap, soonest first). Each row deep-links into the maintenance's detail page. The section renders nothing when there is no upcoming work, so the dashboard stays calm. In-progress windows are surfaced separately as per-system signals in the "System health" overview; this section is the forward-looking companion.
- **The system detail page** shows upcoming and active maintenances for that system.
- **The Maintenances list** (main nav) shows every window, past and future, with status filtering.

## Hotlinks

Standard hotlink slots, identical to incidents: free-form URL labels for change tickets, runbooks, chat threads, or anything else worth attaching. The maintenance detail page has a **Links** section for managing them; each change saves immediately.

## Maintenances and integrations

The lifecycle events (created, status changed, completed, cancelled) flow through the integration system the same way incident events do. You can mirror them to a Slack channel, a status page, or any HTTP webhook. See [Integrations](/checkstack/user-guide/concepts/integrations/).

## Mass actions

The maintenances list supports acting on many windows at once. Select rows with
the leading checkboxes (or use "Select all"), then use the toolbar to:

- **Mass complete**: close every selected, still-open window early (status ->
  `completed`). Windows already completed or cancelled are skipped.
- **Mass delete**: permanently delete the selected maintenances. This is
  destructive and asks for confirmation first.

You can only select maintenances you are allowed to manage: a checkbox appears
only on rows you can act on, so a team-scoped member sees checkboxes only for the
windows their team manages. After a mass action, Checkstack shows a short
summary such as "3 completed, 1 skipped" - a skipped entry is one that no longer
qualified (already completed/cancelled, deleted, or not yours to manage).

## UI tour

| Where to go | What you do there |
|-------------|-------------------|
| **Dashboard** | See the soonest upcoming (scheduled) maintenances at a glance. |
| **Maintenances** (list) | See scheduled, in-progress, and past maintenances. Filter by status. Select rows for mass complete / mass delete. |
| **Schedule Maintenance** | Create one. Pick the time window, attach systems, decide on suppression. |
| **Maintenance detail** | Complete, post updates, manage hotlinks, and restrict team access - all self-persisting. Use the edit dialog for the deferred-save fields (title, schedule, affected systems). |
| **System detail** | See the upcoming and active maintenances for this system. |

## Where to go next

- **Hands-on.** Walk through [Schedule a maintenance window](/checkstack/user-guide/guides/schedule-maintenance/).
- **Silencing.** Read [Silence alerts](/checkstack/user-guide/guides/silence-alerts/) for the suppress-notifications mechanics.
- **Unplanned counterpart.** [Incidents](/checkstack/user-guide/concepts/incidents/) cover the same shape for unplanned work.
- **Forwarding outside.** [Integrations](/checkstack/user-guide/concepts/integrations/) can post maintenance events to your status page or chat.
