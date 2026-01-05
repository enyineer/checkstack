import { z } from "zod";
import { Bot } from "grammy";
import {
  createBackendPlugin,
  secret,
  Versioned,
  type NotificationStrategy,
  type NotificationSendContext,
  type NotificationDeliveryResult,
} from "@checkmate/backend-api";
import { notificationStrategyExtensionPoint } from "@checkmate/notification-backend";
import { pluginMetadata } from "./plugin-metadata";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Configuration Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Admin configuration for Telegram strategy.
 */
const telegramConfigSchemaV1 = z.object({
  botToken: secret().describe("Telegram Bot API Token from @BotFather"),
});

type TelegramConfig = z.infer<typeof telegramConfigSchemaV1>;

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
## Connect Your Telegram Account

1. Click the **Connect** button above
2. A Telegram login dialog will appear
3. Confirm the login in Telegram to link your account
4. Once connected, you'll receive notifications directly in Telegram from the bot

> **Tip**: For personal notifications, use a private chat with the bot, not a group chat.
`.trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Telegram Strategy Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Escape special characters for Telegram MarkdownV2.
 */
function escapeMarkdownV2(text: string): string {
  // Using RegExp instead of inline regex to avoid String.raw lint warning
  const pattern = /[_*[\]()~`>#+=|{}.!-]/g;
  return text.replaceAll(pattern, String.raw`\$&`);
}

/**
 * Convert simple markdown to Telegram MarkdownV2.
 * Handles: **bold** -> *bold*, *italic* -> _italic_
 */
function markdownToTelegram(markdown: string): string {
  let result = markdown;

  // Convert **bold** to *bold* (Telegram uses single asterisks)
  result = result.replaceAll(/\*\*(.+?)\*\*/g, "*$1*");

  // Convert *italic* to _italic_ (Telegram uses underscores)
  result = result.replaceAll(/(?<!\*)(\*)([^*]+)\1(?!\*)/g, "_$2_");

  return result;
}

/**
 * Telegram notification strategy using grammY.
 */
const telegramStrategy: NotificationStrategy<TelegramConfig> = {
  id: "telegram",
  displayName: "Telegram",
  description: "Send notifications via Telegram bot messages",
  icon: "send",

  config: new Versioned({
    version: 1,
    schema: telegramConfigSchemaV1,
  }),

  // Custom resolution - handled via Telegram Login Widget callback
  contactResolution: { type: "custom" },

  adminInstructions,
  userInstructions,

  async send(
    context: NotificationSendContext<TelegramConfig>
  ): Promise<NotificationDeliveryResult> {
    const { contact, notification, strategyConfig } = context;

    if (!strategyConfig.botToken) {
      return {
        success: false,
        error: "Telegram bot token not configured",
      };
    }

    if (!contact) {
      return {
        success: false,
        error: "User has not linked their Telegram account",
      };
    }

    try {
      // Create bot instance
      const bot = new Bot(strategyConfig.botToken);

      // Build message text
      let messageText = `*${escapeMarkdownV2(notification.title)}*`;

      if (notification.body) {
        messageText += `\n\n${markdownToTelegram(notification.body)}`;
      }

      // Add importance indicator
      const importanceEmoji = {
        info: "ℹ️",
        warning: "⚠️",
        critical: "🚨",
      };
      messageText = `${
        importanceEmoji[notification.importance]
      } ${messageText}`;

      // Build inline keyboard for action button
      const inlineKeyboard = notification.action
        ? {
            inline_keyboard: [
              [
                {
                  text: notification.action.label,
                  url: notification.action.url,
                },
              ],
            ],
          }
        : undefined;

      // Send the message
      const result = await bot.api.sendMessage(contact, messageText, {
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
