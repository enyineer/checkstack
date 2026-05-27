---
title: "Wire up Slack notifications"
description: "Install the Slack notification plugin, create a Slack incoming webhook, subscribe a system to it, and confirm delivery."
---

This walkthrough connects Checkstack to a Slack workspace so users receive notifications when system health changes or an incident is updated. Slack delivery uses incoming webhooks, so every user provides their own webhook URL; there is no admin-level Slack credential to manage.

## 1. Install the Slack plugin

If your instance does not already have the Slack notification plugin installed, follow [Install a plugin](/checkstack/user-guide/guides/install-a-plugin/) to add `@checkstack/notification-slack-backend` from npm.

Once installed, the **Slack** strategy appears in the notification settings.

## 2. Create a Slack incoming webhook

In Slack, mint an incoming webhook for the channel that should receive notifications:

1. Open [Slack API Apps](https://api.slack.com/apps) and create a new app (or pick an existing one).
2. Under **Features**, click **Incoming Webhooks** and toggle the feature **On**.
3. Click **Add New Webhook to Workspace**.
4. Select the channel that should receive notifications. You can also point the webhook at a private channel or your own DM channel for personal notifications.
5. Copy the **Webhook URL**. It looks like `https://hooks.slack.com/services/T.../B.../...`.

> [!IMPORTANT]
> Treat the webhook URL as a secret. Anyone with the URL can post to the channel as the app.

## 3. Register the webhook in Checkstack

Each user configures their own webhook from their notification settings:

1. Click your avatar in the top-right corner and open **Notification settings**.
2. In the **Channels** section, find **Slack** and click **Configure**.
3. Paste the webhook URL into the **Slack Incoming Webhook URL** field.
4. Click **Save**.

Checkstack validates that the URL is well-formed and stores it encrypted at rest.

## 4. Subscribe to a system or check

A configured channel is dormant until you subscribe it to something:

1. Open the system you want notifications for from the **Catalog**.
2. Click **Subscribe** in the system header.
3. Pick **Slack** as the channel.
4. Choose what to receive:
   - **Status changes** - notify when the system flips between healthy, degraded, or unhealthy.
   - **Incident updates** - notify when an incident attached to this system is opened, updated, or resolved.
   - **Maintenance updates** - notify when scheduled maintenance starts or ends.
5. Click **Save subscription**.

> [!TIP]
> You can also subscribe to a single health check instead of a whole system. Useful when one check on a noisy system needs its own alert routing.

## 5. Test delivery

Trigger a low-stakes notification to verify the wiring before you rely on it:

1. From the same system page, click **Send test notification** in the subscription detail.
2. Within a second or two, the configured Slack channel receives a styled message: an importance emoji, the system name, and a link back to the Checkstack page.

If nothing arrives:

- Re-open **Notification settings** and confirm the webhook URL is correct.
- Open the **Delivery log** (from the user menu) and look for a row matching the test attempt. The log records every dispatch, including failures with the response body Slack returned.
- Confirm the Slack app is still installed in your workspace and the webhook has not been revoked.

## 6. Tune the noise level

Once delivery works, prune false-positive noise:

- Adjust the system's state thresholds so it does not flip on a single failed run.
- Subscribe only to the importance levels you want. The Slack message colour and emoji are driven by importance (`info`, `warning`, `critical`).
- During known disruptions, set a suppress-notifications flag. See [Silence alerts](/checkstack/user-guide/guides/silence-alerts/).

## See also

- [Notifications](/checkstack/user-guide/concepts/notifications/) - the underlying delivery model.
- [Install a plugin](/checkstack/user-guide/guides/install-a-plugin/) - how to add the Slack plugin if it is not installed yet.
- [Silence alerts](/checkstack/user-guide/guides/silence-alerts/) - suppress notifications during incidents and maintenances.
