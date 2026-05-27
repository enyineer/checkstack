---
title: "Schedule a maintenance window"
description: "Schedule a planned maintenance window for one or more systems, suppress alert noise during the window, and post updates as work progresses."
---

A maintenance window is a planned, scheduled disruption: a database backup that takes a service offline for ten minutes, a deploy that bounces an API, a hardware swap. This walkthrough schedules a window, attaches affected systems, controls the notification noise during the window, and resolves it cleanly when done.

Worked example: scheduling a weekly database backup window every Sunday from 02:00 UTC to 04:00 UTC.

For the underlying model, see [Maintenances](/checkstack/user-guide/concepts/maintenances/).

## 1. Open the Maintenances page

From the sidebar, open **Maintenances**. The page lists every scheduled, in-progress, and completed maintenance with title, time range, and affected systems.

## 2. Create the maintenance

1. Click **New maintenance** in the top-right corner.
2. Fill in the dialog:
   - **Title** - short, descriptive. For example `Weekly DB backup window`.
   - **Description** - context for on-call: what is happening, what to expect, who is responsible.
   - **Start date & time** - the planned start. The picker defaults to one hour from now.
   - **End date & time** - the planned end. Must be after start.
   - **Affected systems** - tick every system this window touches. At least one is required.

For the worked example:

- Title: `Weekly DB backup window`
- Start: next Sunday at 02:00 UTC
- End: same day at 04:00 UTC
- Affected systems: `Payments DB`, `Reporting DB`, `Auth DB`

## 3. Decide whether to suppress notifications

While the maintenance is `in_progress` (between the start and end times), the affected systems are likely to flip into `degraded` or `unhealthy`. Each flip would normally fire a notification.

In the **Suppress notifications** section, toggle the flag **on** if you do not want subscribers to receive a separate alert for every flip during the window.

> [!NOTE]
> Suppression kicks in only when the maintenance is `in_progress`. Maintenances in `scheduled` (waiting to start) or `completed` (already ended) do not silence anything. See [Silence alerts](/checkstack/user-guide/guides/silence-alerts/) for the full silencing contract.

## 4. Save

Click **Create**. The maintenance lands with status `scheduled`. It will transition to `in_progress` automatically at the start time and to `completed` at the end time.

The Catalog system detail page now shows a "Scheduled maintenance" badge on each affected system, with the start time and a link to the maintenance.

## 5. Recurring vs one-off windows

Checkstack treats every maintenance as a single window. A "recurring weekly backup" is not modelled as a recurrence rule; it is one window per occurrence.

Two ways to handle this:

- **Author each occurrence by hand** - fine for ad-hoc work or rare recurrences. Click **New maintenance** each time.
- **Author each occurrence via GitOps** - declare the next occurrence in a YAML file in your GitOps-managed repo and the reconciler creates it on push. Useful for a stable schedule. See [GitOps kind reference](/checkstack/user-guide/reference/gitops-kinds/) for the descriptor schema.

> [!TIP]
> If you find yourself authoring the same window every week by hand, switch to GitOps. The reconciler diffs declared windows against persisted ones, so re-pushing the same YAML is a no-op.

## 6. Post updates as work progresses

Just like incidents, maintenances have a status timeline. Post updates from the editor:

1. Open the maintenance from the list (or stay in the editor).
2. In the **Status Updates** section, click **Add Update**.
3. Fill in:
   - **Update message** - what is happening or what changed.
   - **Change status** - optional; transition to the next state.

Typical timeline for the backup window example:

1. (Auto-transition to `in_progress` at 02:00 UTC.)
2. Update: "Backup started. Payments DB is taking the write lock for the next 20 minutes."
3. Update with status `monitoring`: "Backup completed at 02:42. Watching for slow queries on the warm cache."
4. (Auto-transition to `completed` at 04:00 UTC, or post a manual `completed` update earlier if you finished ahead of schedule.)

Each update is its own timeline entry. Subscribers receive a notification for each one (unless suppression is on, in which case only the maintenance's own updates are still sent - see step 3).

## 7. Cancel or extend

If plans change:

- **Cancel** - delete the maintenance from the list. It moves to the trash and no longer silences anything.
- **Extend** - edit the maintenance, push out the end time, save. If the window is already `in_progress`, extending keeps suppression active until the new end time.
- **Reschedule** - edit start and end while still `scheduled`. Once a window has started, you cannot move the start time backward.

## 8. Resolve the window

When the work is done:

- Let the end time pass naturally - Checkstack auto-transitions to `completed`.
- Or post a `completed` status update if you finished early. Suppression lifts immediately on transition.

The system detail pages now show a "Recent maintenance" history entry instead of the active badge.

## 9. Manage access

By default, anyone with `maintenance.maintenances.read` can see this window. Restrict it via the **Team access** editor on the maintenance if it should only be visible to a specific team.

## See also

- [Maintenances](/checkstack/user-guide/concepts/maintenances/) - the underlying model.
- [Silence alerts](/checkstack/user-guide/guides/silence-alerts/) - rules for suppression during incidents and maintenances.
- [GitOps kind reference](/checkstack/user-guide/reference/gitops-kinds/) - declaring maintenances as YAML for recurring schedules.
