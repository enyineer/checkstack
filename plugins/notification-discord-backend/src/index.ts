import { z } from "zod";
import {
  createBackendPlugin,
  configString,
  Versioned,
  type NotificationStrategy,
  type NotificationSendContext,
  type NotificationDeliveryResult,
  markdownToPlainText,
} from "@checkstack/backend-api";
import { notificationStrategyExtensionPoint } from "@checkstack/notification-backend";
import { pluginMetadata } from "./plugin-metadata";
import { extractErrorMessage } from "@checkstack/common";

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
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp?: string;
}

function buildDiscordEmbed(options: DiscordEmbedOptions): DiscordEmbed {
  const { title, body, importance, action } = options;

  // Discord colors are decimal values
  const importanceColors: Record<string, number> = {
    info: 0x3B_82_F6, // Blue
    warning: 0xF5_9E_0B, // Amber
    critical: 0xEF_44_44, // Red
  };

  const importanceEmoji: Record<string, string> = {
    info: "ℹ️",
    warning: "⚠️",
    critical: "🚨",
  };

  const embed: DiscordEmbed = {
    title: `${importanceEmoji[importance]} ${title}`,
    color: importanceColors[importance],
    timestamp: new Date().toISOString(),
  };

  if (body) {
    // Convert markdown to plain text for better Discord compatibility
    embed.description = markdownToPlainText(body);
  }

  if (action?.url) {
    embed.fields = [
      {
        name: action.label,
        value: `[Click here](${action.url})`,
        inline: false,
      },
    ];
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

      try {
        // Build the embed
        const embed = buildDiscordEmbed({
          title: notification.title,
          body: notification.body,
          importance: notification.importance,
          action: notification.action,
        });

        // Send to Discord webhook
        const response = await fetch(userConfig.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            embeds: [embed],
          }),
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error("Failed to send Discord message", {
            status: response.status,
            error: errorText.slice(0, 500),
          });
          return {
            success: false,
            error: `Failed to send Discord message: ${response.status}`,
          };
        }

        // Discord webhooks return 204 No Content on success
        return {
          success: true,
        };
      } catch (error) {
        const message = extractErrorMessage(error, "Unknown Discord API error");
        logger.error("Discord notification error", { error: message });
        return {
          success: false,
          error: `Failed to send Discord notification: ${message}`,
        };
      }
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

// Export for testing
export { discordConfigSchemaV1, discordUserConfigSchema, buildDiscordEmbed };
export type { DiscordConfig, DiscordUserConfig, DiscordEmbedOptions };
