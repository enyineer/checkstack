---
title: Integrations
description: Reusable connections to external systems (Jira, Teams, Webex, webhooks) that automation actions call out through.
---

An integration is a connection to an external system that [automation](/checkstack/user-guide/concepts/automations/) actions use to do work: file a Jira ticket, post a card to a Teams or Webex space, or POST a payload to any HTTP endpoint. Integrations are no longer a standalone "event to subscription to delivery" mechanism. Today they supply the connection plus the callable actions; the automation platform decides when those actions run and in what order.

## Integrations vs notifications

Both integrations and [Notifications](/checkstack/user-guide/concepts/notifications/) deliver outside the UI, but they cover different needs:

| | Notifications | Integrations |
|---|---|---|
| Audience | Individual users who subscribed | A channel, ticket queue, or external system |
| Configured by | Each user, in their settings | An admin, once, for the whole org |
| Driven by | Per-user subscriptions to targets | Admin-managed connections plus [automation](/checkstack/user-guide/concepts/automations/) actions |
| Typical use | "Send my Slack DM when my system is unhealthy" | "Open a Jira ticket when any incident opens" |
| Examples | Slack DM, SMTP, Telegram | Jira project, Teams channel, custom webhook |

A team would typically run both: each on-call gets personal notifications, and an admin wires up an integration so an automation can file a ticket or post to a shared channel when a major event happens.

## The pieces

The integration system has two building blocks, and the actual "do something" step lives in an automation:

- **Providers.** Plugins that define a connection to an external system. A provider declares a connection schema, an optional test-connection endpoint, and optional dynamic option resolvers that feed the automation editor's config dropdowns. Bundled providers include Jira, Microsoft Teams, and Webex.
- **Connections.** Admin-created, credentialed instances of a provider, stored centrally and encrypted at rest. A connection is selectable in an automation action's config form.

The work itself is an **automation action** (for example `integration-jira.create_issue`) that references a connection through its provider id. When the action runs, it resolves that connection's credentials and calls the external system.

> [!NOTE]
> Not every integration needs a reusable connection. The webhook and script plugins contribute automation actions that carry their configuration inline (a target URL, an auth header, a script body), so there is no separate connection to manage for them.

## How an integration is used

An integration never fires on its own. It runs as a step inside an automation:

1. An automation trigger fires (an incident opened, a system degraded, a schedule elapsed).
2. The automation runs its steps. One of those steps is an integration action.
3. The action runs as the automation's `runAs` service account, resolves its connection's credentials, and calls the external system.
4. The result (an external id such as a Jira issue key, plus any errors and retries) is recorded in the automation **run log**, not a separate delivery log.

Retry and queue semantics belong to the automation platform: a slow or failing external call is retried by the run engine, and you inspect what happened in the run detail view. See [Automations](/checkstack/user-guide/concepts/automations/) for triggers, steps, artifacts, and run history.

> [!TIP]
> Actions can pass results downstream. `integration-jira.create_issue` produces a `jira.issue` artifact that a later step (for example "add a comment" or "transition the issue") can consume, so a single automation can open a ticket and keep it updated.

## Bundled integrations

The integration plugins shipped with Checkstack at the time of writing:

| Integration plugin | What it contributes |
|------------------|--------------|
| `integration-jira-backend` | A Jira connection plus actions to create, transition, comment on, and search issues. Create produces a `jira.issue` artifact later steps can read. |
| `integration-teams-backend` | A Microsoft Teams connection plus an action to post a message to a channel. |
| `integration-webex-backend` | A Webex connection plus an action to post a message to a space. |
| `integration-webhook-backend` | A generic HTTP action that POSTs a JSON (or form-encoded) payload to a URL you configure inline. The most flexible option. |
| `integration-script-backend` | Actions that run a shell command or a TypeScript script for arbitrary custom logic. |

There is no dedicated Slack integration provider. For Slack, either use the generic webhook action with a Slack incoming webhook URL, or use the Slack **notification** plugin for per-user delivery.

> [!NOTE]
> "Notification" plugins (Slack DM, Discord, SMTP, ...) are separate from "Integration" plugins. Notifications are for per-user delivery; integrations are org-wide connections and actions that automations drive. Both can coexist.

## UI tour

| Where to go | What you do there |
|-------------|-------------------|
| **Platform -> Integrations** | Land on the provider list. Every registered integration provider appears here. |
| **Platform -> Integrations -> a provider** | Manage that provider's connections (create, edit, test, delete). Providers without a connection schema show no connections to manage. |
| **Automations editor** | Add an integration action to an automation and pick the connection it uses. This is where delivery is actually wired up. |
| **Plugin Manager** | Install or remove integration provider plugins. |

## Security notes

- Connection configurations are encrypted at rest using your `ENCRYPTION_MASTER_KEY`. Jira credentials, Teams and Webex tokens, and any inline webhook secret live in the database as ciphertext. See [Secret encryption](/checkstack/user-guide/reference/secret-encryption/).
- Integration actions run as the automation's `runAs` service account and are gated by the action's required access rules. Being able to author an automation does not by itself grant the ability to act on a connection: the service account still needs the matching access rule. See [Automations](/checkstack/user-guide/concepts/automations/) for how `runAs` bounds what an automation may do.
- Errors surfaced from an external call are masked before they reach the run log so a credential echoed in a raw error does not leak.

## Where to go next

- **Orchestration.** [Automations](/checkstack/user-guide/concepts/automations/) covers triggers, actions, artifacts, and run history - the engine that drives every integration.
- **Hands-on, common channels.** Walk through [Wire up Slack notifications](/checkstack/user-guide/guides/wire-up-slack/).
- **Personal alerts.** [Notifications](/checkstack/user-guide/concepts/notifications/) covers the per-user equivalent.
- **Authoring your own provider.** See the developer-side [Integration providers](/checkstack/developer-guide/backend/integrations/providers/) docs.
