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
> Be ruthless about what counts as a System. One System per service is the right granularity. If you find yourself making a "Foo - production" and "Foo - staging" pair, that is fine; if you start making "Foo - login flow" and "Foo - checkout flow", you have probably blurred the line between a System and a health check.

### What a System is not

A System is not the same as a host, an environment, or a Kubernetes pod. It is the *logical* thing you care about. The health check is what decides "this URL on this host is the way I observe it".

## Groups

A **Group** is a flat label that bundles related systems together. Use groups to model:

- **Teams.** "Payments", "Identity", "Platform".
- **Tiers.** "Tier 1", "Customer-facing", "Internal-only".
- **Domains.** "Production", "Staging" (though you can also model environments as separate systems).

Groups are flat. Checkstack does not nest groups inside other groups today. A system can belong to multiple groups, so you can cross-cut by team and by tier at the same time.

> [!NOTE]
> Subscribing to notifications for a group automatically catches every system in that group. When the catalog adds or removes a system from the group, group subscribers update instantly without you re-subscribing per system.

Groups are managed under **Catalog -> Groups** in the UI. You can drag systems between groups, rename groups in place, and delete them when they become empty.

## Dependencies

A **Dependency** is a directional edge between two systems: "Payment API depends on Payment DB". When the upstream system is unhealthy, the downstream system's effective state reflects that impact.

Each dependency carries an **impact type**:

- **`informational`** records the link in the dependency map but does not change downstream state.
- **`degraded`** marks the downstream system as degraded if the upstream is unhealthy.
- **`critical`** marks the downstream system as unhealthy if the upstream is unhealthy.

```
            depends on
Payment API  ---------->  Payment DB
   (downstream)            (upstream)
   impactType: critical
```

You can attach optional **per-health-check rules** to a dependency. By default the impact applies whenever the upstream system is unhealthy on any of its checks; with rules you can scope the impact to specific checks only. For example, "Payment API only goes degraded when Payment DB's TLS check fails, not when its replication-lag check fails."

A dependency can also be marked **transitive** to let it cascade further down the chain.

> [!IMPORTANT]
> Dependencies do not auto-open incidents. They affect derived health state and which alerts get suppressed in cascades, nothing more. See [Incidents](/checkstack/user-guide/concepts/incidents/) for the human workflow.

The dependency map lives under **Catalog -> Dependencies**. Node positions are saved per user, so your layout follows you across devices.

## Putting it together

A small example of how the pieces compose for an e-commerce stack:

```
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

## UI tour

| Where to go | What you do there |
|-------------|-------------------|
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
