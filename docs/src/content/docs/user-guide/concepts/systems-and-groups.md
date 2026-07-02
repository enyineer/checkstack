---
title: Systems and groups
description: Systems are the catalog units you monitor. Groups bundle them by team or domain, and dependencies model upstream/downstream impact.
---

The catalog is the backbone of Checkstack. Everything else (health checks, incidents, maintenances, notifications) attaches to a System. This page explains what a System is, how Groups organise them, and how Dependencies model real-world impact between Systems.

## Systems

A **System** is the smallest unit you monitor. It usually maps to one logical service in your stack: a database, an API, a worker, a third-party endpoint, a Minecraft server, a Jenkins controller, anything you want to know the health of.

Every system carries:

- A **name** (required) and an optional **description**.
- **Contacts**, which are either platform users or free-form mailboxes (email addresses). Contacts surface on the system detail page so anyone responding to an incident knows who owns it.
- **Links**, which are free-form URL hotlinks (runbooks, Jira boards, dashboards) shown alongside the system.
- Membership in zero or more **Groups**.

> [!TIP]
> Be ruthless about what counts as a System. One System per service is the right granularity. Do **not** clone a service per environment: a "Foo - production" / "Foo - staging" pair is the wrong model. Keep a single `Foo` System and attach [Environments](/checkstack/user-guide/concepts/environments/) to it - one health-check assignment then runs once per environment. If you start making "Foo - login flow" and "Foo - checkout flow", you have probably blurred the line between a System and a health check.

### What a System is not

A System is not the same as a host, an environment, or a Kubernetes pod. It is the *logical* thing you care about. The health check is what decides "this URL on this host is the way I observe it". Where a System runs - production, staging, a region - is modelled with [Environments](/checkstack/user-guide/concepts/environments/), which attach to one System many-to-many so a single check fans out across all of them.

## Groups

A **Group** is a flat label that bundles related systems together. Use groups to model:

- **Teams.** "Payments", "Identity", "Platform".
- **Tiers.** "Tier 1", "Customer-facing", "Internal-only".
- **Domains.** "Production", "Staging" as flat labels. For real deployment context - per-environment health, custom fields, or one check that fans out per environment - use [Environments](/checkstack/user-guide/concepts/environments/) instead of cloning a system or relying on a group.

Groups are flat. Checkstack does not nest groups inside other groups today. A system can belong to multiple groups, so you can cross-cut by team and by tier at the same time.

> [!NOTE]
> Subscribing to notifications for a group automatically catches every system in that group. When the catalog adds or removes a system from the group, group subscribers update instantly without you re-subscribing per system.

Groups are managed under **Catalog -> Groups** in the UI. You can drag systems between groups, rename groups in place, and delete them when they become empty. The management page carries the same toolbar as the browse view, so you can search and filter the systems and groups lists while you arrange them.

> [!TIP]
> Drag-and-drop assignment is keyboard-operable. Focus a system's drag handle, press Space or Enter to pick it up, move between groups with the arrow keys, and press Space or Enter again to drop it (Escape cancels). The assign button on each system row is an equivalent pointer-free alternative.

## Dependencies

A **Dependency** is a directional edge between two systems: "Payment API depends on Payment DB". When the upstream system is unhealthy, the downstream system's effective state reflects that impact.

Each dependency carries an **impact type**:

- **`informational`** records the link in the dependency map but does not change downstream state.
- **`degraded`** marks the downstream system as degraded if the upstream is unhealthy.
- **`critical`** marks the downstream system as unhealthy if the upstream is unhealthy.

```text
            depends on
Payment API  ---------->  Payment DB
   (downstream)            (upstream)
   impactType: critical
```

You can attach optional **per-health-check rules** to a dependency. By default the impact applies whenever the upstream system is unhealthy on any of its checks; with rules you can scope the impact to specific checks only. For example, "Payment API only goes degraded when Payment DB's TLS check fails, not when its replication-lag check fails."

A dependency can also be marked **transitive** to let it cascade further down the chain.

> [!IMPORTANT]
> Dependencies do not auto-open incidents. They affect derived health state and which alerts get suppressed in cascades, nothing more. See [Incidents](/checkstack/user-guide/concepts/incidents/) for the human workflow.

The dependency map lives under **Workspace -> Dependency Map**. Node positions are saved per user, so your layout follows you across devices. Each edge line is colored end-to-end by its impact type - sky for informational, amber for degraded, red for critical - matching the legend, so you can read an edge's impact from any point along the line and not just its arrowhead. Selecting an edge turns the whole line the primary color.

> [!NOTE]
> The full dependency map is gated by its own access rule and is only available to signed-in users (granted to them by default via their role). It cannot be granted to anonymous visitors: the map exposes the entire system topology, so its access rule is not usable by the anonymous role. Per-system dependency *warnings* (the badges and dashboard signals) stay public, so anonymous visitors still see when a system is affected by an upstream problem - they just do not get the full topology view.

## Putting it together

A small example of how the pieces compose for an e-commerce stack:

```text
Groups:
  - "Payments team": [Payment API, Payment DB, Stripe webhook]
  - "Tier 1":        [Payment API, Checkout API, Storefront]

Systems:
  Storefront    ----(critical)---> Checkout API
  Checkout API  ----(critical)---> Payment API
  Payment API   ----(critical)---> Payment DB
                ----(degraded)---> Stripe webhook
```

A failing Payment DB now drives the derived state for Payment API, Checkout API, and Storefront. A failing Stripe webhook only degrades Payment API. Anyone subscribed to the "Payments team" group sees the relevant notifications; anyone subscribed to "Tier 1" sees the customer-facing ones.

## Browsing the catalog

The catalog home page is a read-only, group-first browse view. It is the landing page for everyone with catalog read access, managers and non-managers alike. It is built to stay legible at hundreds of systems across many groups.

The view organises systems into collapsible **group sections**. Each section header shows the group name and its member count. A synthetic **Ungrouped** section collects systems that belong to no group. Because a system can belong to several groups, it appears under each group it is a member of.

### Inline health rollups

When a health source such as the healthcheck plugin is installed, each group header also shows a **health rollup** pill summarising its members at a glance: "All healthy", "N degraded", or "N unhealthy" (the worst member status wins, with a count). Individual unhealthy or degraded systems still show their own badge on the row; healthy systems show none, so the absence of a badge means healthy or not yet measured.

The rollup drives the default open state: groups where every member is healthy start **collapsed** so your attention goes to the groups that need it, while any group with a degraded, unhealthy, or not-yet-measured member starts **expanded**. You can always toggle a section open or closed yourself, and that choice is captured in the URL. With no health source installed, headers show member counts only and every group starts expanded.

The **Health** filter then lets you narrow to a single state. Selecting `unknown` shows systems with no measured health (no checks wired yet); a system with no reported health is never silently counted as healthy.

A toolbar above the sections lets you narrow what you see:

- **Search** matches systems and groups by name and description, case-insensitively. A match inside a collapsed group auto-expands that group; groups with no match drop out while you are searching.
- **Group**, **Health**, and **Tag** filters narrow the list further. Filters compose: applying more than one shows only the systems that satisfy all of them. (The Health filter activates once a health source such as the healthcheck plugin is installed.)
- **Density** switches rows between Comfortable (descriptions shown inline) and Compact (single-line rows, descriptions on hover).

Every part of the view state lives in the URL, so a filtered, searched view is a shareable link. For example:

```text
/catalog/?q=checkout&group=payments&density=compact
```

opens the catalog pre-filtered to the Payments group, searching for "checkout", in compact density. Open or closed group sections are captured in the link too, so a teammate opening it sees exactly what you see.

Managers see a **Manage catalog** link in the header that jumps to the management page below.

## UI tour

| Where to go | What you do there |
|-------------|-------------------|
| **Catalog** (home) | Browse, search, and filter every system, grouped by team or domain. Read-only. |
| **Catalog -> Systems** | Create, edit, and delete systems. Set contacts and hotlinks. |
| **Catalog -> Groups** | Create groups, drag systems in and out. |
| **Catalog -> Dependencies** | Visual graph editor. Click a system to connect it to another. |
| **System detail page** | See attached health checks, recent runs, contacts, links, and the systems that depend on it. |

## Where this maps in the data model

For operators who want to peek behind the curtain:

- Systems live in the `catalog-backend` plugin's schema, in the `systems` table.
- Groups live in the `groups` table; the join is `systems_groups`.
- Hotlinks and contacts live in `system_links` and `system_contacts`.
- Dependencies are stored by `dependency-backend` in the `dependencies` table.

You should rarely need to query these directly, but the structure is open: every read happens through the platform's typed RPC and respects [Teams and access](/checkstack/user-guide/concepts/teams-and-access/).

## Where to go next

- **First system, first check.** Walk through [Set up your first health check](/checkstack/user-guide/guides/first-health-check/).
- **Notifications.** Read [Notifications](/checkstack/user-guide/concepts/notifications/) to understand how group membership drives delivery.
- **YAML-as-code.** The [GitOps](/checkstack/user-guide/concepts/gitops/) flow lets you express systems, groups, and dependencies as YAML in a Git repo.
