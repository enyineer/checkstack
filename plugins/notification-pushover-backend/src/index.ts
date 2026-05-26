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
import {
  notificationStrategyExtensionPoint,
  postJson,
} from "@checkstack/notification-backend";
import { pluginMetadata } from "./plugin-metadata";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Configuration Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Admin configuration for Pushover strategy.
 * Admins register an app at pushover.net and provide the API token.
 */
const pushoverConfigSchemaV1 = z.object({
  apiToken: configString({ "x-secret": true }).describe(
    "Pushover Application API Token",
  ),
});

type PushoverConfig = z.infer<typeof pushoverConfigSchemaV1>;

/**
 * User configuration for Pushover - users provide their user key.
 */
const pushoverUserConfigSchema = z.object({
  userKey: configString({ "x-secret": true }).describe("Pushover User Key"),
});

type PushoverUserConfig = z.infer<typeof pushoverUserConfigSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instructions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const adminInstructions = `
## Register a Pushover Application

1. Go to [Pushover](https://pushover.net/) and sign in
2. Scroll to the bottom and click **Create an Application/API Token**
3. Fill in the application details:
   - **Name**: e.g., "Checkstack Notifications"
   - **Type**: Application
   - **Description**: (optional)
4. Click **Create Application**
5. Copy the **API Token/Key** and paste it in the field above

> **Note**: The API token is shared across all users. Each user provides their own User Key.
`.trim();

const userInstructions = `
## Get Your Pushover User Key

1. Go to [Pushover](https://pushover.net/) and sign in (or create an account)
2. Your **User Key** is displayed on the main page after login
3. Copy the key and paste it in the field above

> **Tip**: Make sure you have the Pushover app installed on your device to receive notifications.
`.trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Priority Mapping
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Maps notification importance to Pushover priority.
 * Pushover priorities: -2=lowest, -1=low, 0=normal, 1=high, 2=emergency
 */
function mapImportanceToPriority(
  importance: "info" | "warning" | "critical",
): number {
  const priorityMap: Record<string, number> = {
    info: 0, // Normal
    warning: 1, // High (bypasses quiet hours)
    critical: 2, // Emergency (requires acknowledgment)
  };
  return priorityMap[importance];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pushover API Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";

// Emergency priority parameters
const EMERGENCY_RETRY_SECONDS = 60; // Retry every 60 seconds
const EMERGENCY_EXPIRE_SECONDS = 3600; // Expire after 1 hour

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pushover Strategy Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Pushover notification strategy using REST API.
 */
const pushoverStrategy: NotificationStrategy<
  PushoverConfig,
  PushoverUserConfig
> = {
  id: "pushover",
  displayName: "Pushover",
  description: "Send notifications via Pushover mobile app",
  icon: "Smartphone",

  config: new Versioned({
    version: 1,
    schema: pushoverConfigSchemaV1,
  }),

  // User-config resolution - users enter their user key
  contactResolution: { type: "user-config", field: "userKey" },

  userConfig: new Versioned({
    version: 1,
    schema: pushoverUserConfigSchema,
  }),

  adminInstructions,
  userInstructions,

  async send(
    context: NotificationSendContext<PushoverConfig, PushoverUserConfig>,
  ): Promise<NotificationDeliveryResult> {
    const { userConfig, notification, strategyConfig, logger } = context;

    if (!strategyConfig.apiToken) {
      return {
        success: false,
        error: "Pushover API token not configured",
      };
    }

    if (!userConfig?.userKey) {
      return {
        success: false,
        error: "User has not configured their Pushover user key",
      };
    }

    const priority = mapImportanceToPriority(notification.importance);

    // Build message body. Pushover supports a constrained HTML subset, so
    // subjects render as an HTML list with anchor tags when URLs exist.
    let message = notification.body
      ? markdownToPlainText(notification.body)
      : notification.title;
    const subjects = notification.subjects ?? [];
    if (subjects.length > 0) {
      const items = subjects
        .map((subject) =>
          subject.url
            ? `<li><a href="${subject.url}">${subject.name}</a></li>`
            : `<li>${subject.name}</li>`,
        )
        .join("");
      message += `\n\n<b>Affected:</b><ul>${items}</ul>`;
    }

    // Build request body
    const body: Record<string, string | number> = {
      token: strategyConfig.apiToken,
      user: userConfig.userKey,
      title: notification.title,
      message,
      priority,
      html: 1, // Enable HTML formatting
    };

    // Add action URL if present
    if (notification.action?.url) {
      body.url = notification.action.url;
      body.url_title = notification.action.label;
    }

    // Emergency priority requires retry and expire parameters
    if (priority === 2) {
      body.retry = EMERGENCY_RETRY_SECONDS;
      body.expire = EMERGENCY_EXPIRE_SECONDS;
    }

    // Send to Pushover
    const apiResult = await postJson({
      url: PUSHOVER_API_URL,
      body,
      serviceName: "Pushover",
      logger,
    });
    if (!apiResult.ok) {
      return { success: false, error: apiResult.error };
    }

    const result = (await apiResult.response.json()) as {
      status: number;
      request: string;
      receipt?: string;
    };

    if (result.status !== 1) {
      return {
        success: false,
        error: "Pushover API returned error status",
      };
    }

    return {
      success: true,
      externalId: result.receipt ?? result.request,
    };
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

    // Register the Pushover strategy with our plugin metadata
    extensionPoint.addStrategy(pushoverStrategy, pluginMetadata);
  },
});

/**
 * Internal exports for the package's own unit tests. Not part of the plugin's
 * public API surface — consumers must depend on the plugin entrypoint, not
 * these helpers.
 * @internal
 */
export {
  pushoverConfigSchemaV1,
  pushoverUserConfigSchema,
  mapImportanceToPriority,
  PUSHOVER_API_URL,
  EMERGENCY_RETRY_SECONDS,
  EMERGENCY_EXPIRE_SECONDS,
};
/** @internal */
export type { PushoverConfig, PushoverUserConfig };
