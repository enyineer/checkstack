import { z } from "zod";
import {
  createBackendPlugin,
  configString,
  Versioned,
  type NotificationStrategy,
  type NotificationSendContext,
  type NotificationDeliveryResult,
  type NotificationSubject,
  markdownToSlackMrkdwn,
} from "@checkstack/backend-api";
import {
  notificationStrategyExtensionPoint,
  postJson,
  SUBJECT_STATUS_EMOJI,
  IMPORTANCE_EMOJI,
} from "@checkstack/notification-backend";
import { pluginMetadata } from "./plugin-metadata";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Configuration Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Admin configuration for Slack strategy.
 * Optional - no admin config required since users provide their own webhooks.
 */
const slackConfigSchemaV1 = z.object({});

type SlackConfig = z.infer<typeof slackConfigSchemaV1>;

/**
 * User configuration for Slack - users provide their webhook URL.
 */
const slackUserConfigSchema = z.object({
  webhookUrl: configString({}).url().describe("Slack Incoming Webhook URL"),
});

type SlackUserConfig = z.infer<typeof slackUserConfigSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instructions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const adminInstructions = `
## Slack Notifications

Slack notifications are delivered via incoming webhooks that users configure individually.
Each user provides their own webhook URL in their notification settings.

No admin configuration is required for this strategy.
`.trim();

const userInstructions = `
## Create a Slack Incoming Webhook

1. Go to [Slack API Apps](https://api.slack.com/apps) and create a new app (or select existing)
2. Under **Features**, click **Incoming Webhooks** and toggle it **On**
3. Click **Add New Webhook to Workspace**
4. Select a channel where you want to receive notifications
5. Copy the **Webhook URL** and paste it in the field above

> **Tip**: You can create webhooks for private channels or your own DM channel for personal notifications.
`.trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Slack Block Kit Builder
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SlackBlockOptions {
  title: string;
  body?: string;
  importance: "info" | "warning" | "critical";
  action?: { label: string; url: string };
  subjects?: NotificationSubject[];
}

interface SlackPayload {
  text: string; // Fallback text for notifications
  blocks: Array<Record<string, unknown>>;
  attachments?: Array<{ color: string }>;
}

/** Render the subjects list as a Slack mrkdwn bullet list. */
function renderSubjectsAsMrkdwn(subjects: NotificationSubject[]): string {
  return [
    "*Affected:*",
    ...subjects.map((subject) => {
      const statusPrefix = subject.status
        ? `${SUBJECT_STATUS_EMOJI[subject.status]} `
        : "• ";
      return subject.url
        ? `${statusPrefix}<${subject.url}|${subject.name}>`
        : `${statusPrefix}${subject.name}`;
    }),
  ].join("\n");
}

function buildSlackPayload(options: SlackBlockOptions): SlackPayload {
  const { title, body, importance, action, subjects } = options;


  // Attachment colors for importance-based accent
  const importanceColors: Record<string, string> = {
    info: "#3b82f6", // Blue
    warning: "#f59e0b", // Amber
    critical: "#ef4444", // Red
  };

  const blocks: Array<Record<string, unknown>> = [
    // Header section with title
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${IMPORTANCE_EMOJI[importance]} *${title}*`,
      },
    },
  ];

  // Body section (if provided)
  if (body) {
    const mrkdwnBody = markdownToSlackMrkdwn(body);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: mrkdwnBody,
      },
    });
  }

  // Subjects section (if provided)
  if (subjects && subjects.length > 0) {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: renderSubjectsAsMrkdwn(subjects),
        },
      },
    );
  }

  // Action button (if provided)
  if (action?.url) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: action.label,
            emoji: true,
          },
          url: action.url,
          action_id: "notification_action",
        },
      ],
    });
  }

  return {
    text: `${IMPORTANCE_EMOJI[importance]} ${title}`, // Fallback for notifications
    blocks,
    attachments: [{ color: importanceColors[importance] }],
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Slack Strategy Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Slack notification strategy using incoming webhooks.
 */
const slackStrategy: NotificationStrategy<SlackConfig, SlackUserConfig> = {
  id: "slack",
  displayName: "Slack",
  description: "Send notifications via Slack incoming webhooks",
  icon: "Hash",

  config: new Versioned({
    version: 1,
    schema: slackConfigSchemaV1,
  }),

  // User-config resolution - users enter their webhook URL
  contactResolution: { type: "user-config", field: "webhookUrl" },

  userConfig: new Versioned({
    version: 1,
    schema: slackUserConfigSchema,
  }),

  adminInstructions,
  userInstructions,

  async send(
    context: NotificationSendContext<SlackConfig, SlackUserConfig>,
  ): Promise<NotificationDeliveryResult> {
    const { userConfig, notification, logger } = context;

    if (!userConfig?.webhookUrl) {
      return {
        success: false,
        error: "User has not configured their Slack webhook URL",
      };
    }

    // Build the Slack payload
    const payload = buildSlackPayload({
      title: notification.title,
      body: notification.body,
      importance: notification.importance,
      action: notification.action,
      subjects: notification.subjects,
    });

    // Send to Slack webhook
    const result = await postJson({
      url: userConfig.webhookUrl,
      body: payload,
      serviceName: "Slack",
      logger,
    });
    return result.ok
      ? { success: true }
      : { success: false, error: result.error };
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin Definition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Get the notification strategy extension point
    const extensionPoint = env.getExtensionPoint(
      notificationStrategyExtensionPoint,
    );

    // Register the Slack strategy with our plugin metadata
    extensionPoint.addStrategy(slackStrategy, pluginMetadata);
  },
});

/**
 * Internal exports for the package's own unit tests. Not part of the plugin's
 * public API surface.
 * @internal
 */
export { slackConfigSchemaV1, slackUserConfigSchema, buildSlackPayload };
/** @internal */
export type { SlackConfig, SlackUserConfig, SlackBlockOptions, SlackPayload };
