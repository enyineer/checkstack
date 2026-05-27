---
title: "Notification troubleshooting"
description: "Step-by-step diagnosis for missing or duplicate notifications - delivery logs, subscriptions, integration health, and silencing rules."
---

This page walks you from "I didn't get a notification" to a concrete fix. Notifications in Checkstack pass through several layers (event source -> subscription -> strategy -> delivery), and each layer can drop or suppress a message. The order below mirrors that pipeline, so the first answer that says "no" is your problem.

## Step 1: confirm a notification was attempted

The platform records every dispatch attempt in the **Delivery Attempts** page (Notifications -> Delivery Attempts in the sidebar) and, for integration providers, in **Delivery Logs** (Integrations -> Delivery Logs).

What to look for:

| What the log says | What it means | Where to go next |
|-------------------|---------------|------------------|
| No row for the event | The platform never tried to send. | Step 2 (subscriptions) and step 4 (silencing). |
| Row with status `delivered` | The platform sent it successfully. | Check the receiving end (inbox, Slack channel, ...). Use the timestamp and target shown. |
| Row with status `failed` | The strategy returned an error. | Inspect the error column and go to step 3 (integration health). |
| Row with status `skipped` | A maintenance window or open incident suppressed the notification. | Step 4 (silencing). |

> [!TIP]
> The Notifications page (bell) shows only what was *delivered to you*. The Delivery Attempts page shows what the platform *tried* across all targets - reach for that one when diagnosing missing messages.

## Step 2: check subscriptions

A user only receives a notification if they (or their team) are subscribed to the event source.

1. Open **Settings -> Notification settings**.
2. Confirm the target type you expect (email, Slack, ...) is enabled and the address/channel is correct.
3. Confirm a subscription exists for the source: a system, system group, or an event type that covers the failing check.

A common gotcha: subscriptions to a *group* don't backfill when a new system is added to the group; check that the affected system is actually covered by the subscription you expect.

For the concept overview see [Notifications](/checkstack/user-guide/concepts/notifications/).

## Step 3: check integration health

If Delivery Attempts shows `failed`, the target strategy could not deliver. Most of the time this is a credential or connectivity problem at the destination.

1. Go to **Integrations -> Integrations** and click the affected provider (Slack, Teams, webhook, ...).
2. Use the **Test connection** action. If the test fails, the credentials or URL are wrong.
3. Open the **Delivery Logs** page and read the error column for the failing rows. Common patterns:
   - `401 Unauthorized` - token expired or revoked at the destination. Regenerate at the destination, update in Checkstack.
   - `connection refused` / `ETIMEDOUT` - target URL is unreachable from the Checkstack container.
   - `429 Too Many Requests` - the destination is rate-limiting you. Reduce subscription cadence or batch.
   - `400 Bad Request` - the destination rejected the payload. Inspect the response body in the log row.

For webhook-style integrations, check that any IP allow-list at the destination includes the Checkstack egress IP.

## Step 4: check silencing

Two distinct mechanisms can silence a notification *deliberately*:

### Active maintenance window

A maintenance window with `suppressNotifications = true` silences notifications for every system it covers, for as long as it is active.

1. Open **Maintenances** and look for a window that overlaps the dispatch time *and* covers the affected system.
2. The window must be in the `active` status. Windows in `scheduled` or `completed` do not silence.

If you find an unexpectedly active window, you can edit its `suppressNotifications` toggle to allow alerts again without changing the window dates.

### Active incident

An incident with `suppressNotifications = true` silences downstream alerts for its affected systems while it is open.

1. Open **Incidents** and filter by status `open`.
2. Look for an incident whose affected systems include the one you expected an alert about.
3. If the incident exists and is silencing, either resolve it or toggle off `suppressNotifications` on the incident detail page.

For the full silencing contract (which read sites honour it and which don't) see [Silence alerts](/checkstack/user-guide/guides/silence-alerts/).

## Step 5: verify the underlying event happened

If steps 1-4 all look fine and you still got nothing, sanity-check that the event actually happened.

- Open the affected system's health check history. Was there a status transition in the expected window? A check that was already unhealthy and stays unhealthy does not fire a new notification.
- For incident-based notifications, check that the incident transitioned to a status that triggers your subscription (some subscriptions only fire on creation, not on every update).

## Step 6: duplicate notifications

If you're getting *too many*, the most common cause is overlapping subscriptions - the same user is subscribed at both the system and the system-group level, and each subscription dispatches independently. Open **Notification settings** and prune.

Each notification strategy (Slack, Teams, etc.) also de-duplicates within a short window, but cross-target duplicates (one Slack + one email for the same event) are by design - that is what subscribing to two targets does.

## Where to go next

- [Notifications](/checkstack/user-guide/concepts/notifications/) - the concept overview.
- [Silence alerts](/checkstack/user-guide/guides/silence-alerts/) - the operator-facing silencing walkthrough.
- [Notification delivery](/checkstack/developer-guide/backend/notifications/delivery/) - developer-facing internals of the dispatch pipeline.
