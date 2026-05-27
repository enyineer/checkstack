---
title: "Silence alerts during an incident"
description: "Suppress notification noise for a system using incident suppression, scheduled maintenance, or per-subscription mute, and understand what each option covers."
---

When something is broken, the last thing on-call needs is twenty pages of duplicate alerts. Checkstack offers a small, intentional set of silencing tools. This guide walks through the three ways to silence, when to reach for each, and exactly what they suppress versus leave running. For the engineering contract behind silencing, see [Alert silencing (developer)](/checkstack/developer-guide/architecture/alert-silencing/).

## The shape of silencing in Checkstack

Silencing is a read-path filter. The flagged record (incident or maintenance) is consulted by a fixed set of dispatch loops before they send. If the record is active and silencing is on, the dispatcher logs the suppression in the delivery log and returns without sending the notification.

> [!IMPORTANT]
> Silenced notifications still appear in the delivery log. They do not go out to external channels, but the audit trail is preserved. Use the delivery log to confirm a notification was silenced (and why) rather than lost.

There are three options for silencing today:

1. **Incident with suppress-notifications flag** - silence reactively, when something is already broken.
2. **Maintenance window with suppress-notifications flag** - silence proactively, for a planned, scheduled disruption.
3. **Per-subscription mute** - silence a single channel without affecting anything else.

## 1. Silence with an incident suppress flag

Use this when something is broken right now and you want to stop the noise immediately.

1. Open the **Incidents** page and click **New incident** (or open the existing incident if one is already open).
2. In the dialog, tick the **Affected systems** that should fall silent.
3. Toggle **Suppress notifications** on.
4. Click **Create** (or **Update**).

The suppression is active as long as the incident is active - any status that is NOT `resolved` qualifies (`investigating`, `identified`, `fixing`, `monitoring`). Resolving the incident lifts the suppression immediately; the next health-state change after that fires normally.

What is silenced:

- Health-state-change notifications on the affected systems (the noisy "now unhealthy / now healthy / now unhealthy" stream).
- Dependency-cascade notifications - if an upstream system you marked is silenced, downstream alerts that would cascade from it are also skipped.

What is NOT silenced:

- The incident's own update timeline. Status updates and notes you post are intentionally always sent. Subscribers see your progress.
- Notifications about resources that are not attached to the incident.

The full operator walkthrough is [Open and resolve an incident](/checkstack/user-guide/guides/open-and-resolve-incident/).

## 2. Silence with a scheduled maintenance

Use this when you know a disruption is coming and want to pre-arm the silencing.

1. Open the **Maintenances** page and click **New maintenance**.
2. Set the start and end times, attach the affected systems.
3. Toggle **Suppress notifications** on.
4. Click **Create**.

> [!NOTE]
> Suppression on a maintenance kicks in only when the maintenance transitions to `in_progress`. A `scheduled` maintenance (waiting to start) or a `completed` one (already ended) does not silence anything. Checkstack auto-transitions at the start and end times.

What is silenced: same as incident suppression - health-state-change and dependency-cascade notifications for the affected systems while the window is `in_progress`.

What is NOT silenced: the maintenance's own update timeline, and resources not attached to the window.

The full operator walkthrough is [Schedule a maintenance window](/checkstack/user-guide/guides/schedule-maintenance/).

## 3. Mute a single subscription

The two flags above silence at the system level, for everyone subscribed. If only one person's pager is being noisy:

1. From the user menu, open **Notification settings**.
2. Find the subscription that is firing too much.
3. Toggle it off, or narrow it to a higher importance threshold (e.g. only `critical`).

This is per-user; it does not affect anyone else's deliveries on the same system.

## Which option to use

| Situation | Use |
|-----------|-----|
| Something is broken right now and we are reporting it. | Incident with suppress flag. |
| Planned maintenance is scheduled. | Maintenance window with suppress flag. |
| My personal subscription is firing for a non-issue. | Per-subscription mute. |
| A specific health check is genuinely too noisy (always). | Tune the check's state thresholds instead of silencing. |

## What silencing does NOT cover

Silencing is intentionally narrow. The following dispatch paths bypass the silencing check by design:

- **Manual or ad-hoc notifications** triggered outside the health-check and dependency-cascade loops. If an operator hits "Send test notification" on a subscription, that always sends.
- **Direct dispatches from third-party plugins** that bypass the platform's silencing check.
- **Notifications about resources not attached to the silencing record** - silencing is per-system. If an incident silences System A and System B starts failing, System B's notifications still fire.

If you flag a record as silenced and a notification keeps firing through what should be a silenced channel, check the [delivery log](/checkstack/user-guide/reference/public-rest-api/) for the row and look at the dispatch source. The dispatcher for that channel probably does not consult the silencing check; the engineering side of the contract is documented in [Alert silencing (developer)](/checkstack/developer-guide/architecture/alert-silencing/).

## See also

- [Open and resolve an incident](/checkstack/user-guide/guides/open-and-resolve-incident/) - the suppress-on-incident workflow.
- [Schedule a maintenance window](/checkstack/user-guide/guides/schedule-maintenance/) - the suppress-on-maintenance workflow.
- [Notifications](/checkstack/user-guide/concepts/notifications/) - the underlying delivery model.
- [Alert silencing (developer)](/checkstack/developer-guide/architecture/alert-silencing/) - the engineering contract behind suppression.
