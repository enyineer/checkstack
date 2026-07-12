---
title: "Open and resolve an incident"
description: "Manually open an incident, attach affected systems, post status updates, transition through the lifecycle states, and resolve it."
---

Incidents in Checkstack are hand-reported events: a human decides that something is wrong, opens an incident with the affected systems, and posts updates until it is resolved. Checkstack does NOT auto-open incidents from failing health checks. Failing checks flip the system status, burn SLO error budget, and notify subscribers, but the incident timeline is yours to author.

This walkthrough takes you through one full incident: open it, attach systems, suppress notification noise from the affected systems, transition through investigating, identified, fixing, monitoring, and finally resolved.

For the underlying model, see [Incidents](/checkstack/user-guide/concepts/incidents/).

## 1. Open the Incidents page

From the sidebar, open **Incidents**. The page lists every incident on this instance with title, severity, status, and the systems each one affects.

## 2. Create a new incident

1. Click **New incident** in the top-right corner.
2. Fill in the dialog:
   - **Title** - short, descriptive, present tense. For example `Payments API returning 502s`.
   - **Description** - the long-form context: what is broken, who reported it, anything reproducible.
   - **Severity** - pick one of `minor`, `major`, or `critical`. Severity is informational; it does not change Checkstack's behaviour.
   - **Affected systems** - tick every system this incident touches. At least one is required. The list is scoped to systems you can read.
3. Click **Create**.

The incident lands with status `investigating` and appears in the list.

## 3. Decide whether to suppress notifications

While the incident is open, health-state changes on the affected systems will keep firing notifications by default. Two flips per minute on a flapping HTTP endpoint quickly drowns the on-call channel.

In the **Suppress notifications** section of the incident editor, toggle the flag **on** if:

- The affected systems are likely to keep flipping during the incident, and
- You do not want each flip to go out to subscribers as a separate alert.

> [!NOTE]
> Suppression applies to health-state-change notifications and dependency-cascade notifications for the affected systems. It does NOT suppress the incident's own update timeline - status changes and notes you post are intentionally always sent so on-call channels see your progress. See [Silence alerts](/checkstack/user-guide/guides/silence-alerts/) for the full silencing contract.

Click **Update** to save.

> [!NOTE]
> The create/edit dialog carries only the deferred-save fields (title, description, severity, affected systems, health override, and notification suppression). Status updates, hotlinks, and team access are living data that you manage on the incident's **detail page** - each change there saves immediately. The dialog links you to the detail page when you are editing an existing incident.

## 4. Post a status update with the first transition

Once you have started investigating, post your first update:

1. Open the incident's detail page (click it in the list).
2. In the **Status Updates** section, click **Add Update**.
3. Fill in:
   - **Update message** - what you have learned so far, for example "Saw a spike in 502s starting 14:02. Looking at the load balancer logs."
   - **Change status** - leave on `Keep Current` for the first note (still investigating), or transition to a more advanced state as your understanding firms up.
4. Click **Post Update**.

The update lands in the timeline with a timestamp.

## 5. Transition through the lifecycle

Checkstack's incident lifecycle is a strict forward path. You move through these states by selecting them in the **Change status** dropdown when posting updates:

| Status | When to use it |
|--------|----------------|
| `investigating` | Initial state. You know something is wrong but not why. |
| `identified` | You have found the root cause. Communication is now about the fix, not the diagnosis. |
| `fixing` | A fix is in progress. |
| `monitoring` | The fix is deployed. You are watching to confirm the impact is gone. |
| `resolved` | Confirmed resolved. The incident closes. |

A representative timeline:

1. **Investigating**: "Saw a spike in 502s starting 14:02. Looking at the load balancer logs."
2. **Identified**: "Root cause is a misconfigured rate limiter on the payments API. Limit was 10 rps instead of 1000 rps."
3. **Fixing**: "Rolling out a hotfix that resets the rate limiter to 1000 rps."
4. **Monitoring**: "Hotfix deployed at 14:31. Error rate dropped to zero. Watching for the next 15 minutes."
5. **Resolved**: "Clean for 20 minutes. Closing this out."

Each status update is its own entry in the timeline; subscribers receive a notification for each one (unless their subscription is set to only the digest).

## 6. Attach links

On the incident's detail page, use the **Hotlinks** section to attach external context: the Jira ticket tracking the postmortem, the runbook you followed, the dashboard you used to confirm recovery. Each link you add saves immediately. Links live on the incident permanently and are surfaced to everyone who can read the incident.

## 7. Resolve the incident

Posting an update with status `resolved` closes the incident:

- It disappears from the **Active** tab on the Incidents page and shows up under **Resolved**.
- Notification suppression on its affected systems lifts immediately (assuming no other active incident or maintenance is silencing them).
- The system health badges on the catalog page no longer show the "active incident" indicator.

## 8. Manage access to the incident

By default, anyone with the global `incident.incidents.read` rule can see this incident. If the incident contains sensitive context (security disclosures, customer-identifying details), restrict it:

1. Open the incident's detail page.
2. Scroll to **Team access**.
3. Click **Add team grant** and pick the team that should see it.
4. The incident becomes invisible to users who lack both a global role and a team grant.

> [!TIP]
> The same Team access editor is on every resource's detail page. See [Create your first team](/checkstack/user-guide/guides/create-a-team/) for the team management workflow.

## See also

- [Incidents](/checkstack/user-guide/concepts/incidents/) - lifecycle, status semantics, and how incidents relate to health-check failures.
- [Silence alerts](/checkstack/user-guide/guides/silence-alerts/) - operator-facing rules for suppressing notifications.
- [Schedule a maintenance window](/checkstack/user-guide/guides/schedule-maintenance/) - the planned-disruption counterpart.
