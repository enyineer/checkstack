---
title: Integrations
description: Outbound webhooks that forward platform events to Slack, Jira, Teams, and other external systems.
---

Integrations are how Checkstack pushes events out to tools your team already uses: file a Jira ticket when an incident opens, post a card to a Slack channel when a maintenance starts, drop a structured payload on any HTTP endpoint when a system goes red. This page describes the model. For configuring a specific provider, see the relevant guide under the Guides section.

## Integrations vs notifications

Both integrations and [Notifications](/checkstack/user-guide/concepts/notifications/) deliver outside the UI, but they cover different needs:

| | Notifications | Integrations |
|---|---|---|
| Audience | Individual users who subscribed | A channel, ticket queue, or external system |
| Configured by | Each user, in their settings | An admin, once, for the whole org |
| Driven by | Subscriptions to targets | Provider + event subscriptions |
| Typical use | "Send my Slack DM when my system is unhealthy" | "Post to #ops-alerts when any incident opens" |
| Examples | Slack DM, SMTP, Telegram | Slack channel webhook, Jira project, custom webhook |

A team would typically run both: each on-call gets personal notifications, and an admin wires up a Slack channel integration so the whole team sees major events even if nobody's settings happen to be configured.

## The pieces

The integration system has three building blocks:

- **Providers.** Plugins that know how to deliver events to a specific external system. Bundled providers include generic webhook, Slack, Microsoft Teams, Webex, Telegram, and Jira. You can also use the script integration to write arbitrary delivery logic.
- **Events.** The platform's hooks (`incident.created`, `healthcheck.state-changed`, `maintenance.started`, ...) exposed as subscribable external events. Plugins decide which of their hooks become events.
- **Subscriptions.** Admin-configured rules that say "when event X fires, deliver through provider Y with configuration Z, optionally filtered by system list."

A single subscription connects exactly one event to one provider. Admins create as many subscriptions as they need.

## How an event flows out

Roughly:

```text
[domain plugin] emits hook ----+
                               |
                               v
                  +-------------------------+
                  |    Event Registry       |
                  | (is this hook a public  |
                  |  event? who is subscribed?) |
                  +-------------------------+
                               |
                               v
              for each matching subscription
                               |
                               v
                  +-------------------------+
                  |   queue a delivery job  |
                  +-------------------------+
                               |
                               v
                  +-------------------------+
                  |   provider.deliver()    |
                  |  (HTTP call, Slack API,  |
                  |   Jira create, ...)     |
                  +-------------------------+
                               |
                               v
                  +-------------------------+
                  |   write delivery log    |
                  +-------------------------+
```

The queue step exists so a slow provider does not block the originating plugin, and so failed deliveries can be retried independently.

## Subscriptions in detail

When you create a subscription you choose:

- **A provider.** "Generic webhook", "Slack", "Jira", and so on. The set of providers depends on which integration plugins you have installed.
- **A provider configuration.** The fields the provider needs (Slack token, Jira project key, target URL, ...). Sensitive fields are encrypted at rest.
- **An event.** A single event ID from the catalogue of registered events, fully qualified (`incident-backend.incident.created`, `healthcheck-backend.state-changed`, ...).
- **Optional system filters.** A list of system IDs to scope to. The subscription fires only when the event involves one of those systems. Leave empty to receive events for every system.
- **Enabled / disabled.** Pause a subscription temporarily without losing its configuration.

> [!TIP]
> Use system filters for noisy events. "State-changed" fires every time any check transitions, which is a lot. If you only care about Tier 1 systems, list them in the filter rather than firehosing everything into Slack.

## The delivery log

Every delivery attempt writes a row to the delivery log with:

- The event payload that was delivered.
- The status: `pending`, `success`, `failed`, or `retrying`.
- The number of attempts.
- The timestamp of the last attempt and (if retrying) the next retry.
- Any **external ID** returned by the target system (for example, the Jira issue key created by the delivery), so a follow-up event can correlate to the same external record.
- The error message if the last attempt failed.

Admins can inspect this log from the integrations admin UI to debug a dead webhook or a misconfigured Jira project without grepping logs.

## Bundled providers

The integration plugins shipped with Checkstack at the time of writing:

| Provider plugin | What it does |
|------------------|--------------|
| `integration-webhook-backend` | Generic HTTP POST with the event payload as JSON. The most flexible option. |
| `integration-teams-backend` | Post a card to a Microsoft Teams channel. |
| `integration-webex-backend` | Post a message to a Webex space. |
| `integration-jira-backend` | Create a Jira issue, update on follow-up events. |
| `integration-script-backend` | Run a script to deliver, for arbitrary custom logic. |

For Slack channel delivery you can either install a dedicated Slack provider plugin (if available in the Plugin Manager) or use the generic webhook provider with Slack's incoming webhook URL.

> [!NOTE]
> "Notification" plugins (Slack DM, Discord, SMTP, ...) are separate from "Integration" plugins. The notification side is for per-user delivery; integrations are for org-wide channel delivery. Both can coexist.

## UI tour

| Where to go | What you do there |
|-------------|-------------------|
| **Infrastructure -> Integrations -> Subscriptions** | Create, edit, enable, or disable webhook subscriptions. |
| **Infrastructure -> Integrations -> Delivery Log** | Audit recent delivery attempts. See failures and external IDs. |
| **Plugin Manager** | Install or remove integration provider plugins. |

## Security notes

- Provider configurations are encrypted at rest using your `ENCRYPTION_MASTER_KEY`. Webhook tokens, Slack secrets, Jira credentials all live in the database as ciphertext.
- Delivery error messages are sanitised before storage so secrets embedded in raw error objects do not leak into the delivery log.
- Subscriptions respect your access model. Only admins (or users with the relevant integration access rule) can create or modify them.

## Where to go next

- **Hands-on, common channels.** Walk through [Wire up Slack notifications](/checkstack/user-guide/guides/wire-up-slack/). The same shape applies to Teams, Webex, and Discord.
- **Personal alerts.** [Notifications](/checkstack/user-guide/concepts/notifications/) covers the per-user equivalent.
- **Authoring your own provider.** See the developer-side [Integration providers](/checkstack/developer-guide/backend/integrations/providers/) docs.
