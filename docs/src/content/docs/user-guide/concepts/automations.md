---
title: Automations
description: Wire a trigger to an ordered set of actions that run as a bounded service account, so the platform reacts to events instead of only alerting.
---

An automation wires a trigger to an ordered set of actions, so Checkstack does not just tell you something happened, it reacts. "When this system stays degraded for five minutes, open an incident, file a Jira ticket, and post to the on-call Teams channel" is one automation. This page covers the operator's mental model; for building your own triggers and actions see the [Developer Guide](/checkstack/developer-guide/backend/automations/).

## The building blocks

Every automation is made of:

- **Trigger(s)**: what starts it.
- **Conditions** (optional): gates that decide whether it should proceed.
- **Actions**: the ordered work it performs.
- **A service account** (`runAs`): the identity it runs as (required, see [Who an automation runs as](#who-an-automation-runs-as)).
- **A mode**: how concurrent runs are handled.

## Triggers

A trigger is the entry point. The kinds you will use most:

- **Schedules**: a cron pattern (`0 9 * * 1` for Monday 9am) or a fixed interval.
- **State changes**: an incident was created, updated, or resolved; a system became degraded, healthy, or changed health.
- **Numeric thresholds**: a metric (latency, p95, a collector value) crossed an above/below bound.

Triggers can be refined so they fire only when you mean it:

- A **filter** narrows a trigger to specific cases (only critical severity, only one group).
- A **dwell** ("for") fires only if the condition holds for a duration, so a one-off blip is ignored.
- A **rate gate** ("window") fires only after N occurrences in M minutes, per system.

The exact triggers available depend on which plugins are installed; the editor's trigger picker shows the live list.

## Actions

Actions are the work. Depending on the plugins you have installed, an action can:

- Write to the run log, or send a notification to a user (built in).
- Open, update, or resolve an [incident](/checkstack/user-guide/concepts/incidents/).
- Post to Microsoft Teams or Webex, send a webhook, or file and update a Jira issue (via [integrations](/checkstack/user-guide/concepts/integrations/)).
- Run a shell or TypeScript script for anything not covered by a built-in action.
- Run a bounded AI agent (see [The AI analyze action](#the-ai-analyze-action)).

Actions run in order. Each can produce an artifact (a created ticket, a query result) that a later action reads, so you can branch on what an earlier step found.

> [!TIP]
> For a system Checkstack already integrates with, use that integration's action with a real connection rather than hand-rolling an HTTP request from a script. The integration handles auth, retries, and credentials for you.

## Control flow

Actions are composed with control-flow primitives:

- **choose**: branch (if / else if / else); only the first matching branch runs.
- **parallel**: run several actions at once and wait for all of them.
- **repeat**: loop over a list, a count, or until a condition holds.
- **delay**: pause for a fixed time; the run suspends durably and resumes later.
- **wait for trigger / wait until**: suspend until a matching event arrives or a condition becomes true, then continue.
- **stop**: end the run early, optionally as an error.

## Conditions

A condition is a side-effect-free gate. It never performs I/O or changes state; it only decides yes or no. Use conditions for pre-run gates ("only during business hours", "only if severity is critical") and mid-run guards. They can be combined with and / or / not, and include structured forms for numeric comparisons, time-of-day and weekday windows, and system status.

> [!IMPORTANT]
> Model a decision (such as "only if there is no open ticket") as a condition over a prior query action's result, not as an action that performs I/O. Keeping decisions side-effect-free is what makes a run safe to re-evaluate.

## Who an automation runs as

Every automation runs as a **service account**: an application identity with its own permissions, not your account. This is the platform's main safety boundary for automations.

- Every action authenticates as that service account, so an automation can never do more than its account is allowed.
- You can only choose a service account whose permissions are a **subset of your own**. You can never grant an automation more authority than you hold.
- Individual actions require specific permissions. An integration action like "create a Jira issue" needs that capability granted to the service account's role, and the platform checks this before the action runs (and again when the assistant proposes the automation), so a missing permission shows up as a clear error rather than a first-run failure.

If more than one service account qualifies, you choose which to use. See [API keys and service accounts](/checkstack/user-guide/reference/api-keys/) for creating and granting them.

## The AI analyze action

The `ai_analyze` action runs a bounded AI agent on the automation's context (the trigger payload and any artifacts from earlier steps). It investigates and acts through the same tools the chat assistant uses, but as the automation's service account, so it can never exceed that identity's permissions. It can emit a structured field (for example a `severity`) that a following `choose` branches on, keeping the decision visible in the automation rather than hidden in a prompt.

## Modes

When an automation can fire again while a previous run is still going, the **mode** decides what happens: run one at a time (`single`), allow many at once (`parallel`), queue them (`queued`), or cancel the in-flight run and start fresh (`restart`). The limit can apply to the whole automation or per context (for example, per system).

## Building automations

Open the **Automations** list and create or edit one in the editor, which has a visual builder and a YAML view that round-trip the same definition. The chat [assistant](/checkstack/user-guide/) can also propose an automation for you: it discovers real service accounts, connections, and integration fields before drafting, and validates the result so you review a working automation on a confirm card rather than a plausible-looking guess.

Automations can also be declared in Git as an `Automation` entity kind. A Git-managed automation is read-only in the editor. See the [GitOps entity kinds reference](/checkstack/user-guide/reference/gitops-kinds/).

## Where to go next

- **Triggers from health.** Read [Health checks](/checkstack/user-guide/concepts/health-checks/) and [SLOs](/checkstack/user-guide/concepts/slo/) for common trigger sources.
- **Where actions land.** See [Integrations](/checkstack/user-guide/concepts/integrations/) and [Notifications](/checkstack/user-guide/concepts/notifications/).
- **Run as.** See [API keys and service accounts](/checkstack/user-guide/reference/api-keys/).
