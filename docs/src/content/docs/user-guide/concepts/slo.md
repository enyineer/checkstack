---
title: Service level objectives (SLOs)
description: Reliability targets that track a system's availability against a goal over a rolling window, with an error budget and dependency-aware attribution.
---

A service level objective (SLO) is a reliability target for a system: "this system should be available at least 99.9% of the time over the last 30 days." Checkstack tracks each objective continuously, tells you how much of your error budget is left, and warns you before you breach. SLOs turn the raw healthy/unhealthy readings from your [health checks](/checkstack/user-guide/concepts/health-checks/) into a single number you can hold a service to.

## The basics

An objective is defined by:

- A **system** it measures.
- A **target** percentage (for example `99.9`).
- A **window** in days (a rolling window, for example the last 30 days). The window always ends "now", so the objective is always evaluated against the most recent N days.
- Optionally, a **single health check** to measure. Leave it unset to measure the system's overall health across all its checks.

Availability is computed from health state over the window: a system counts as "good" while it is healthy, and as "down" while it is degraded or unhealthy. Each outage is recorded as a downtime event that opens when the system stops being healthy and closes when it recovers.

## Error budget

The flip side of a target is the downtime it allows. A 99.9% target over 30 days permits roughly 43 minutes of downtime; that allowance is your **error budget**.

- **Budget remaining** is how much of that allowance is still unspent. The UI shows it as a bar that runs green, then amber, then red as it depletes.
- **Burn rate** is how fast you are spending the budget relative to the window. A burn rate above 1 means you are consuming budget faster than the window can sustain. You set **warning** and **critical** burn-rate thresholds per objective (defaults: 50% and 80%).

> [!TIP]
> A healthy burn rate with budget to spare means you can take risks (ship, run maintenance). A high burn rate with little budget left means freeze and protect reliability. That trade-off is the whole point of an SLO.

## Status

At any moment an objective is in one of these states, which surface as a signal on the [dashboard](/checkstack/user-guide/concepts/catalog-and-dashboards/):

| Status | Meaning |
|--------|---------|
| **Healthy** | On track. Availability is above target and budget consumption is nominal. |
| **At risk** | Healthy now, but the remaining error budget is low (20% or less). Approaching a breach. |
| **Degraded** | The system is currently down, and that downtime is counting against this objective. |
| **Breaching** | Measured availability has fallen below the target. |

## Dependency-aware attribution

A system is often down only because something it depends on is down. Counting that against the system's own SLO punishes it for a failure it did not cause. Checkstack's SLOs are **dependency-aware**: each objective chooses how to attribute upstream-caused downtime.

- **Strict** (default): count all downtime, whoever caused it. Use this for a user-facing promise where the cause does not matter.
- **Self-only**: exclude downtime caused by an unhealthy upstream [dependency](/checkstack/user-guide/concepts/systems-and-groups/). The outage is still recorded and attributed, but it does not consume this system's budget.

You can also exclude specific upstream systems explicitly. The objective's detail page shows the attribution breakdown, so you can see exactly which minutes were charged to the system itself versus an upstream.

> [!NOTE]
> Attribution is decided as outages happen, and can split mid-outage: if an upstream goes down partway through a self-caused outage, the remaining minutes are re-attributed to the upstream.

## Incident-forced downtime

An [incident](/checkstack/user-guide/concepts/incidents/) can force a system to
"degraded" or "unhealthy" with a health override, even while its health checks
still pass. That forced downtime is real, so it counts against the affected
system's SLOs the same way a failed check does: while an incident override is
active, an open downtime event is recorded for each of the system's objectives
and consumes the error budget, and the objective reads **Degraded**.

The event closes automatically when the override stops applying - when the
incident is resolved or deleted, or the override is cleared - as long as the
system's health checks are also healthy by then. Downtime is never
double-counted: if a health-check outage and an incident overlap, a single event
covers the period. And one cause can never close downtime the other is still
holding open - resolving an incident while checks are still failing leaves the
outage open, and checks recovering while an incident override is still active
does too.

Each downtime event records its cause (a failed health check or an incident) so
you can tell them apart in the downtime history.

## Notifications and history

- A breaching or recovering objective broadcasts a signal that surfaces on the dashboard and feeds the assistant's "what is wrong?" view.
- A periodic **digest** summarises objectives across all systems (how many are breaching, at risk, and healthy, plus the best and worst performers) through your configured [notification](/checkstack/user-guide/concepts/notifications/) channels.
- Each objective's detail page keeps a trend chart from daily snapshots, a downtime timeline, the attribution breakdown, and streaks, so you can see reliability over time, not just right now.

## Managing SLOs

| Where to go | What you do there |
|-------------|-------------------|
| **Reliability -> SLO overview** | See every objective at a glance with its error-budget bar and burn rate. |
| **Reliability -> Manage SLOs** | Create, edit, and delete objectives. Requires the SLO manage permission. |
| **An objective's detail page** | Drill into one objective: trend, downtime timeline, attribution, streaks. |

SLOs can also be declared in Git as a `SLO` entity kind, so you can manage them alongside the rest of your platform configuration. See the [GitOps entity kinds reference](/checkstack/user-guide/reference/gitops-kinds/).

## Where to go next

- **Availability source.** Read [Health checks](/checkstack/user-guide/concepts/health-checks/) to understand what feeds an objective.
- **Dependencies.** See [Systems and groups](/checkstack/user-guide/concepts/systems-and-groups/) for the dependency model that powers self-only attribution.
- **React to breaches.** Use [Automations](/checkstack/user-guide/concepts/automations/) to act when an objective starts burning budget.
