---
title: Catalog and dashboards
description: The catalog is the inventory of systems you monitor; the dashboard is the aggregated overview that surfaces only the systems needing attention, via signals.
---

The **catalog** is your inventory of what to monitor, and the **dashboard** is the at-a-glance overview built on top of it. The catalog answers "what do we run?"; the dashboard answers "what needs attention right now?". This page focuses on the dashboard and the signals that drive it; for how systems, groups, and dependencies are structured, see [Systems and groups](/checkstack/user-guide/concepts/systems-and-groups/).

## The catalog in one paragraph

The catalog holds your **systems** (the logical services you monitor), the **groups** that organise them, and the **dependencies** between them. A system is a logical unit, not a host or a pod: a database, an API, a worker, a third-party endpoint. Systems carry contacts and links so responders know who owns a service and where its runbook is, and dependencies record which systems rely on which. The catalog browse page lists everything by group with health rollups; [Systems and groups](/checkstack/user-guide/concepts/systems-and-groups/) covers all of that in depth.

## The dashboard

The dashboard is the landing page. It is built to show you the few systems that need attention rather than a wall of green:

- A **fleet header** summarises the whole estate: "all systems healthy", or how many need attention, broken into critical, degraded, and watch counts you can click to filter.
- **Problem cards** show only the systems that currently have a signal. Each card lists that system's signals, worst first, each with a short detail and a link to the source (the incident, the SLO, the failing check, the dependency map).
- An **all clear** state replaces the cards when nothing is wrong.
- A **recent activity** feed streams the latest health-check runs as they complete, so you can see the platform is live and progressing.

Healthy systems are deliberately absent from the problem list; their absence is the signal that they are fine.

## Signals

A **signal** is one piece of "needs attention" state that a feature reports about a system. Signals are the common language the dashboard speaks: every monitoring feature contributes its own, and the dashboard merges them per system.

| Source | A signal means |
|--------|----------------|
| [Health checks](/checkstack/user-guide/concepts/health-checks/) | One or more of the system's checks are failing or degraded. |
| [Incidents](/checkstack/user-guide/concepts/incidents/) | An incident is open against the system. |
| [SLOs](/checkstack/user-guide/concepts/slo/) | An objective is breaching or its error budget is at risk. |
| [Anomaly detection](/checkstack/user-guide/concepts/anomaly-detection/) | A metric is behaving unusually. |
| Dependencies | An upstream system the system relies on has a problem. |
| [Maintenances](/checkstack/user-guide/concepts/maintenances/) | A maintenance window is active for the system. |

Each signal carries a tone (error, warning, or info), a label, a short detail, and usually a link to the page that explains it. The dashboard sorts problem systems by their worst tone, then by how many signals they have, then by how long they have been suffering, so the most urgent work is at the top.

> [!NOTE]
> A signal's tone is about urgency on the dashboard; a system's health status (healthy / degraded / unhealthy) is a separate vocabulary. A system can be healthy yet still carry an info or warning signal, such as an active maintenance or an anomaly.

## Dependency problems on the dashboard

Because the catalog records dependencies, a problem can surface on a system that is itself fine. When an upstream a system depends on goes unhealthy, the dependent system gets a dependency signal ("upstream down" or "upstream degraded") and, depending on the dependency's impact type, its own derived health can change too. This is what "dependency-aware" means in practice: the dashboard shows you both the root cause and everything it is dragging down. See [Systems and groups](/checkstack/user-guide/concepts/systems-and-groups/) for the dependency impact model.

## The assistant uses the same signals

When you ask the chat assistant "what is wrong?" or "what needs attention?", it reads the same per-system signals the dashboard renders, aggregated across every source in one place, so its answer matches what you see on screen.

## Where to go next

- **Catalog structure.** Read [Systems and groups](/checkstack/user-guide/concepts/systems-and-groups/) for systems, groups, and dependencies in depth.
- **The signal sources.** See [Health checks](/checkstack/user-guide/concepts/health-checks/), [Incidents](/checkstack/user-guide/concepts/incidents/), [SLOs](/checkstack/user-guide/concepts/slo/), and [Anomaly detection](/checkstack/user-guide/concepts/anomaly-detection/).
- **Act on a signal.** Use [Automations](/checkstack/user-guide/concepts/automations/) to react automatically.
