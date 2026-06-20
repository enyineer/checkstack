---
title: Notifications
description: How Checkstack delivers in-app and external alerts, who subscribes to what, and how silencing fits in.
---

Notifications are how Checkstack tells humans that something changed. Every state-change event, incident update, anomaly detection, or maintenance announcement runs through the same fan-out mechanism: identify the event, find the people subscribed to it, and deliver the message in-app and through whichever external channels they have configured. This page explains the model.

## Two delivery surfaces

Checkstack delivers every notification in up to two places:

1. **In-app.** A bell icon in the navigation bar shows unread notifications. Each notification has a title, a body (supports Markdown), an importance level (`info`, `warning`, `critical`), an optional primary action button, and a list of "subjects" (chips that link back to the affected entities).
2. **External strategies.** If the recipient has configured an external delivery channel (Slack DM, Discord, email, Telegram, Pushover, ...), the notification is also shipped there. Each external delivery is logged so admins can see whether it succeeded.

In-app is always on. External delivery is opt-in per user, per strategy.

> [!NOTE]
> Most notifications collapse into a single in-app card when they share a "collapse key". For example, multiple health-state transitions for the same system (degraded -> unhealthy -> healthy) appear as one card you can expand, instead of three separate entries.

## Who gets what: subscriptions

The model is "subscribe by target". A **target** is a resource of a known kind (a system, a group, "globally"). A **subscription** says "this user wants to be notified about events of this kind for this target".

Examples:

- "Notify me about anomalies on the **payments-api** system."
- "Notify me about incidents touching any system in the **Payments team** group."
- "Notify me when **any** health check goes unhealthy" (a global subscription).

Subscriptions inherit through resource hierarchies where they exist:

- A system that belongs to a group inherits the group's subscriptions. If you subscribe to the "Payments team" group, you receive notifications for every system in it without subscribing system-by-system.
- New systems added to that group automatically inherit the subscription. No backfill step required.

> [!IMPORTANT]
> Subscriptions belong to **users**, not to roles or teams. Each user controls their own subscription list under their notification settings.

## Notification targets

Every event in the platform carries a target type (`catalog.system`, `catalog.group`, `<plugin>.<resource>`). The targets you typically see in the UI are:

- **Systems**, owned by the catalog plugin.
- **Groups**, owned by the catalog plugin.
- **Global** subscriptions, for events that do not belong to any specific resource (rare, mostly used by platform-level signals).

Other plugins can register their own target types, but the catalog-driven ones cover the day-to-day flows.

## What kinds of notifications you can receive

The bundled plugins emit these notification families:

| Family | Source | Example |
|--------|--------|---------|
| Health-state change | `healthcheck-backend` | "Payment API went unhealthy on HTTP-200 check." |
| Anomaly detected | `anomaly-backend` | "Latency on Payment API drifted above expected range." |
| Incident lifecycle | `incident-backend` | "Incident opened: Payment API outage. Status: investigating." |
| Maintenance lifecycle | `maintenance-backend` | "Scheduled maintenance starting in 15 minutes." |
| Dependency cascade | `dependency-backend` | "Checkout API impacted because Payment DB is unhealthy." |

Each family registers its own subscription specs, so you can subscribe granularly: "incidents only", "anomalies only", "all of the above".

## External strategies

External strategies are notification plugins that deliver the message outside Checkstack. The bundled ones include:

- Slack (DM to a Slack user, or post to a channel).
- Microsoft Teams.
- Discord.
- Email (SMTP).
- Telegram.
- Webex.
- Pushover.
- Gotify.
- Backstage.

Each user configures the strategies they want to receive via, under their notification preferences. Authentication details (Slack OAuth tokens, SMTP passwords, ...) are encrypted at rest. See [Secret encryption](/checkstack/user-guide/reference/secret-encryption/).

External delivery is per-attempt. Each `send()` call writes a row to a delivery attempt log with success/failure status, duration, and an error message if the send failed. Admins can audit failures from the UI to spot a misconfigured webhook or a dead channel.

> [!TIP]
> External strategies do not retry on failure today. A failure is a final, surfaced outcome. If a Slack channel disappears or an SMTP server is unreachable, the attempt logs the failure and moves on. Admins should periodically check the delivery log for repeat failures.

## Silencing

Notifications honour two suppression sources for the systems they affect:

- An **active incident** with `suppressNotifications: true` attached to the system.
- An **in-progress maintenance** with `suppressNotifications: true` attached to the system.

When either match, the platform skips the notification. The relevant dispatch sites are the health-check executor (state transitions) and the dependency notification path (cascades). Suppression does not silence the incident or maintenance's own lifecycle events; those are the whole point of having them.

For the full contract see [Alert silencing](/checkstack/developer-guide/architecture/alert-silencing/). The how-to is [Silence alerts](/checkstack/user-guide/guides/silence-alerts/).

> [!NOTE]
> Suppression is best-effort. If the silencing lookup itself errors (a network blip in a distributed setup), the platform fails open and delivers the notification anyway. Better to deliver a redundant alert than swallow a real one.

## How a notification flows

Roughly, end to end:

```text
[event source] -- emits hook --> [notification-backend]
                                       |
                                       v
                       resolve target -> resource
                                       |
                                       v
                       walk parent edges (group -> system)
                                       |
                                       v
              query subscribers for matching subscriptions
                                       |
                                       v
                 +-----------------+   +--------------------+
                 | write in-app row|   | for each external  |
                 |  (notifications)|   | strategy on user   |
                 +-----------------+   |   strategy.send()  |
                                       +--------------------+
                                                  |
                                                  v
                                       log delivery attempt
```

Silencing checks happen before subscriber resolution; if a system is silenced, the executor that fired the event skips notification dispatch entirely.

## UI tour

| Where to go | What you do there |
|-------------|-------------------|
| **Bell icon** (top nav) | Read in-app notifications, dismiss, jump to subjects. |
| **Notification settings** (profile menu) | Configure external strategies (Slack token, SMTP password, ...). |
| **Notification subscriptions** | Subscribe to systems, groups, and event families. |
| **System detail page -> Subscribe** | Subscribe to all notification families for one system in one click. |
| **Infrastructure -> Notifications -> Delivery log** | Admin view of every external delivery attempt. |

## Where to go next

- **Hands-on.** Walk through [Wire up Slack notifications](/checkstack/user-guide/guides/wire-up-slack/) for a typical external-strategy setup.
- **Silencing.** Read [Silence alerts](/checkstack/user-guide/guides/silence-alerts/).
- **Webhooks to other tools.** [Integrations](/checkstack/user-guide/concepts/integrations/) is the outbound side for things like Jira, distinct from per-user external notifications.
