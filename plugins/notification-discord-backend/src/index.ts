import { z } from "zod";
import {
  createBackendPlugin,
  configString,
  Versioned,
  type NotificationStrategy,
  type NotificationSendContext,
  type NotificationDeliveryResult,
  type NotificationSubject,
  markdownToPlainText,
} from "@checkstack/backend-api";
import {
  notificationStrategyExtensionPoint,
  postJson,
  validateWebhookUrl,
  IMPORTANCE_EMOJI,
  renderSubjectsAsMarkdown,
} from "@checkstack/notification-backend";
import { pluginMetadata } from "./plugin-metadata";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Configuration Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Admin configuration for Discord strategy.
 * Optional - no admin config required since users provide their own webhooks.
 */
const discordConfigSchemaV1 = z.object({});

type DiscordConfig = z.infer<typeof discordConfigSchemaV1>;

/**
 * User configuration for Discord - users provide their webhook URL.
 */
const discordUserConfigSchema = z.object({
  webhookUrl: configString({}).url().describe("Discord Webhook URL"),
});

type DiscordUserConfig = z.infer<typeof discordUserConfigSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instructions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const adminInstructions = `
## Discord Notifications

Discord notifications are delivered via webhooks that users configure individually.
Each user provides their own webhook URL in their notification settings.

No admin configuration is required for this strategy.
`.trim();

const userInstructions = `
## Create a Discord Webhook

1. Open Discord and go to the channel where you want notifications
2. Click the **gear icon** (Edit Channel) next to the channel name
3. Go to **Integrations** → **Webhooks** → **New Webhook**
4. Give your webhook a name (e.g., "Checkstack Alerts")
5. Click **Copy Webhook URL** and paste it in the field above

> **Privacy Note**: This webhook URL is private to you. Only use webhooks for channels you control.
`.trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Discord Embed Builder
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface DiscordEmbedOptions {
  title: string;
  body?: string;
  importance: "info" | "warning" | "critical";
  action?: { label: string; url: string };
  subjects?: NotificationSubject[];
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp?: string;
}

function buildDiscordEmbed(options: DiscordEmbedOptions): DiscordEmbed {
  const { title, body, importance, action, subjects } = options;

  // Discord colors are decimal values
  const importanceColors: Record<string, number> = {
    info: 0x3B_82_F6, // Blue
    warning: 0xF5_9E_0B, // Amber
    critical: 0xEF_44_44, // Red
  };

  const embed: DiscordEmbed = {
    title: `${IMPORTANCE_EMOJI[importance]} ${title}`,
    color: importanceColors[importance],
    timestamp: new Date().toISOString(),
  };

  if (body) {
    // Convert markdown to plain text for better Discord compatibility
    embed.description = markdownToPlainText(body);
  }

  const fields: NonNullable<DiscordEmbed["fields"]> = [];

  if (subjects && subjects.length > 0) {
    // One field summarizing every affected subject as a markdown bullet
    // list. Discord renders [name](url) in field values, and prefixes
    // status with a colored circle when present.
    fields.push({
      name: "Affected",
      value: renderSubjectsAsMarkdown({ subjects, heading: null }),
      inline: false,
    });
  }

  if (action?.url) {
    fields.push({
      name: action.label,
      value: `[Click here](${action.url})`,
      inline: false,
    });
  }

  if (fields.length > 0) {
    embed.fields = fields;
  }

  return embed;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Discord Strategy Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Discord notification strategy using webhooks.
 */
const discordStrategy: NotificationStrategy<DiscordConfig, DiscordUserConfig> =
  {
    id: "discord",
    displayName: "Discord",
    description: "Send notifications via Discord webhooks",
    icon: "MessageCircle",

    config: new Versioned({
      version: 1,
      schema: discordConfigSchemaV1,
    }),

    // User-config resolution - users enter their webhook URL
    contactResolution: { type: "user-config", field: "webhookUrl" },

    userConfig: new Versioned({
      version: 1,
      schema: discordUserConfigSchema,
    }),

    adminInstructions,
    userInstructions,

    async send(
      context: NotificationSendContext<DiscordConfig, DiscordUserConfig>,
    ): Promise<NotificationDeliveryResult> {
      const { userConfig, notification, logger } = context;

      if (!userConfig?.webhookUrl) {
        return {
          success: false,
          error: "User has not configured their Discord webhook URL",
        };
      }

      // SSRF guard: the webhook URL is user-supplied. Reject it up front if it
      // resolves to an internal/reserved address, and refuse redirects below so
      // a receiver cannot 3xx us at an internal host past this pre-flight.
      const validation = await validateWebhookUrl({ url: userConfig.webhookUrl });
      if (!validation.ok) {
        logger.warn(
          `Blocked Discord delivery to ${userConfig.webhookUrl}: ${validation.error}`,
        );
        return { success: false, error: validation.error };
      }

      // Build the embed
      const embed = buildDiscordEmbed({
        title: notification.title,
        body: notification.body,
        importance: notification.importance,
        action: notification.action,
        subjects: notification.subjects,
      });

      // Send to Discord webhook
      const result = await postJson({
        url: userConfig.webhookUrl,
        body: { embeds: [embed] },
        redirect: "error",
        serviceName: "Discord",
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

    // Register the Discord strategy with our plugin metadata
    extensionPoint.addStrategy(discordStrategy, pluginMetadata);
  },
});

/**
 * Internal exports for the package's own unit tests. Not part of the plugin's
 * public API surface.
 * @internal
 */
export {
  discordConfigSchemaV1,
  discordUserConfigSchema,
  buildDiscordEmbed,
  discordStrategy,
};
/** @internal */
export type { DiscordConfig, DiscordUserConfig, DiscordEmbedOptions };
