import { z } from "zod";
import {
  createBackendPlugin,
  configString,
  Versioned,
  type NotificationStrategy,
  type NotificationSendContext,
  type NotificationDeliveryResult,
} from "@checkmate-monitor/backend-api";
import { notificationStrategyExtensionPoint } from "@checkmate-monitor/notification-backend";
import { pluginMetadata } from "./plugin-metadata";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Configuration Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Admin configuration for Webex strategy.
 * Bot tokens are long-lived (100+ years) so no refresh is needed.
 */
const webexConfigSchemaV1 = z.object({
  botToken: configString({ "x-secret": true }).describe(
    "Webex Bot Access Token from developer.webex.com"
  ),
});

type WebexConfig = z.infer<typeof webexConfigSchemaV1>;

/**
 * User configuration for Webex - users provide their Person ID for direct messages.
 */
const webexUserConfigSchema = z.object({
  personId: z.string().min(1).describe("Your Webex Person ID"),
});

type WebexUserConfig = z.infer<typeof webexUserConfigSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instructions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const adminInstructions = `
## Create a Webex Bot

1. Go to [developer.webex.com](https://developer.webex.com/) and sign in
2. Navigate to **My Webex Apps** → **Create a New App** → **Create a Bot**
3. Fill in the bot details:
   - **Bot Name**: Your notification bot name (e.g., "Checkmate Alerts")
   - **Bot Username**: A unique username
   - **Icon**: Upload an icon or use default
   - **Description**: Brief description of the bot
4. Click **Create Bot**
5. Copy the **Bot Access Token** — this is shown only once!

> **Important**: Bot tokens are long-lived (100+ years) but can only be viewed once. Store it securely.
`.trim();

const userInstructions = `
## Get Your Webex Person ID

1. Open your Webex app and start a chat with your organization's notification bot
2. Send any message to the bot (this creates the 1:1 space)
3. To find your Person ID, use one of these methods:

**Method 1: Via Webex Developer Portal**
- Go to [developer.webex.com/docs/api/v1/people/get-my-own-details](https://developer.webex.com/docs/api/v1/people/get-my-own-details)
- Click "Run" — your Person ID is in the response

**Method 2: Ask your admin**
- Your Webex admin can look up your Person ID via the admin console

4. Enter your Person ID above and save

> **Note**: You must have messaged the bot at least once before notifications can be sent.
`.trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Webex Strategy Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WEBEX_API_BASE = "https://webexapis.com/v1";

/**
 * Webex notification strategy.
 * Sends notifications as direct messages via the Webex Messages API.
 */
const webexStrategy: NotificationStrategy<WebexConfig, WebexUserConfig> = {
  id: "webex",
  displayName: "Webex",
  description: "Send notifications via Webex direct messages",
  icon: "MessageSquare",

  config: new Versioned({
    version: 1,
    schema: webexConfigSchemaV1,
  }),

  // User-config resolution - users enter their Person ID
  contactResolution: { type: "user-config", field: "personId" },

  userConfig: new Versioned({
    version: 1,
    schema: webexUserConfigSchema,
  }),

  adminInstructions,
  userInstructions,

  async send(
    context: NotificationSendContext<WebexConfig, WebexUserConfig>
  ): Promise<NotificationDeliveryResult> {
    const { userConfig, notification, strategyConfig } = context;

    if (!strategyConfig.botToken) {
      return {
        success: false,
        error: "Webex bot token not configured",
      };
    }

    if (!userConfig?.personId) {
      return {
        success: false,
        error: "User has not configured their Webex Person ID",
      };
    }

    try {
      // Build message with markdown formatting
      const importanceEmoji = {
        info: "ℹ️",
        warning: "⚠️",
        critical: "🚨",
      };

      let markdown = `${importanceEmoji[notification.importance]} **${
        notification.title
      }**`;

      if (notification.body) {
        markdown += `\n\n${notification.body}`;
      }

      if (notification.action?.url) {
        markdown += `\n\n[${notification.action.label}](${notification.action.url})`;
      }

      // Send message via Webex API
      const response = await fetch(`${WEBEX_API_BASE}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${strategyConfig.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          toPersonId: userConfig.personId,
          markdown,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Webex API error (${response.status}): ${errorText.slice(
            0,
            200
          )}`,
        };
      }

      const result = (await response.json()) as { id?: string };

      return {
        success: true,
        externalId: result.id,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Webex API error";
      return {
        success: false,
        error: `Failed to send Webex message: ${message}`,
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

    // Register the Webex strategy with our plugin metadata
    extensionPoint.addStrategy(webexStrategy, pluginMetadata);
  },
});
