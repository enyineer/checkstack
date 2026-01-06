import { z } from "zod";
import { Bot } from "grammy";
import {
  createBackendPlugin,
  secret,
  Versioned,
  type NotificationStrategy,
  type NotificationSendContext,
  type NotificationDeliveryResult,
} from "@checkmate-monitor/backend-api";
import { notificationStrategyExtensionPoint } from "@checkmate-monitor/notification-backend";
import { pluginMetadata } from "./plugin-metadata";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Configuration Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Admin configuration for Telegram strategy.
 */
const telegramConfigSchemaV1 = z.object({
  botToken: secret({ description: "Telegram Bot API Token from @BotFather" }),
});

type TelegramConfig = z.infer<typeof telegramConfigSchemaV1>;

/**
 * User configuration for Telegram - users provide their own chat ID.
 */
const telegramUserConfigSchema = z.object({
  chatId: z.string().describe("Your Telegram Chat ID"),
});

type TelegramUserConfig = z.infer<typeof telegramUserConfigSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instructions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const adminInstructions = `
## Setup a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. Send \`/newbot\` and follow the prompts to create your bot
3. Copy the **Bot Token** (format: \`123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11\`)
4. Send \`/setdomain\` to BotFather and set your domain (e.g., \`yourdomain.com\`)

> **Note**: The domain must match where Checkmate is hosted for the Login Widget to work.
`.trim();

const userInstructions = `
## Get Your Telegram Chat ID

1. Start a chat with your organization's notification bot
2. Send any message to the bot
3. Open [@userinfobot](https://t.me/userinfobot) and send \`/start\` to get your Chat ID
4. Enter your Chat ID in the field above and save

> **Note**: Make sure you've messaged the notification bot before sending a notification, or the bot won't be able to reach you.
`.trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Telegram Strategy Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// eslint-disable-next-line @typescript-eslint/no-require-imports
const telegramifyMarkdown = require("telegramify-markdown") as (
  markdown: string,
  unsupportedTagsStrategy?: "escape" | "remove" | "keep"
) => string;

/**
 * Telegram notification strategy using grammY.
 */
const telegramStrategy: NotificationStrategy<
  TelegramConfig,
  TelegramUserConfig
> = {
  id: "telegram",
  displayName: "Telegram",
  description: "Send notifications via Telegram bot messages",
  icon: "send",

  config: new Versioned({
    version: 1,
    schema: telegramConfigSchemaV1,
  }),

  // User-config resolution - users enter their chat ID manually
  contactResolution: { type: "user-config", field: "chatId" },

  userConfig: new Versioned({
    version: 1,
    schema: telegramUserConfigSchema,
  }),

  adminInstructions,
  userInstructions,

  async send(
    context: NotificationSendContext<TelegramConfig, TelegramUserConfig>
  ): Promise<NotificationDeliveryResult> {
    const { userConfig, notification, strategyConfig } = context;

    if (!strategyConfig.botToken) {
      return {
        success: false,
        error: "Telegram bot token not configured",
      };
    }

    if (!userConfig?.chatId) {
      return {
        success: false,
        error: "User has not configured their Telegram chat ID",
      };
    }

    try {
      // Create bot instance
      const bot = new Bot(strategyConfig.botToken);

      // Build message body using telegramify-markdown for proper escaping and conversion
      let messageBody = "";
      if (notification.body) {
        messageBody = telegramifyMarkdown(notification.body, "escape");
      }

      // Build title (bold) with proper escaping
      const messageTitle = telegramifyMarkdown(
        `**${notification.title}**`,
        "escape"
      );

      // Add importance indicator
      const importanceEmoji = {
        info: "ℹ️",
        warning: "⚠️",
        critical: "🚨",
      };
      let messageText = `${
        importanceEmoji[notification.importance]
      } ${messageTitle}`;
      if (messageBody) {
        messageText += `\n\n${messageBody}`;
      }

      // Build inline keyboard for action button
      const actionUrl = notification.action?.url;

      // Don't show action button for localhost URLs (Telegram rejects them)
      // Instead, add as inline link in the message
      const isLocalhost =
        actionUrl?.includes("localhost") || actionUrl?.includes("127.0.0.1");

      if (notification.action && actionUrl && isLocalhost) {
        // Add action as plain text (Telegram won't make localhost links clickable anyway)
        // This makes it easier to copy the URL for debugging
        const plainTextAction = `📎 ${notification.action.label}:\n${actionUrl}\n\n_Note: Telegram blocks localhost URLs, so no inline button is shown._`;
        messageText += `\n\n${telegramifyMarkdown(plainTextAction, "escape")}`;
      }

      const inlineKeyboard =
        notification.action && actionUrl && !isLocalhost
          ? {
              inline_keyboard: [
                [
                  {
                    text: notification.action.label,
                    url: actionUrl,
                  },
                ],
              ],
            }
          : undefined;

      // Send the message
      const result = await bot.api.sendMessage(userConfig.chatId, messageText, {
        parse_mode: "MarkdownV2",
        reply_markup: inlineKeyboard,
      });

      return {
        success: true,
        externalId: String(result.message_id),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Telegram API error";
      return {
        success: false,
        error: `Failed to send Telegram message: ${message}`,
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
      notificationStrategyExtensionPoint
    );

    // Register the Telegram strategy with our plugin metadata
    extensionPoint.addStrategy(telegramStrategy, pluginMetadata);
  },
});
