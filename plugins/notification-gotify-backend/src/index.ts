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
  validateWebhookUrl,
  renderSubjectsAsPlainText,
} from "@checkstack/notification-backend";
import { pluginMetadata } from "./plugin-metadata";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Configuration Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Admin configuration for Gotify strategy.
 * Admins configure the Gotify server URL.
 */
const gotifyConfigSchemaV1 = z.object({
  serverUrl: configString({})
    .url()
    .describe("Gotify server URL (e.g., https://gotify.example.com)"),
});

type GotifyConfig = z.infer<typeof gotifyConfigSchemaV1>;

/**
 * User configuration for Gotify - users provide their app token.
 */
const gotifyUserConfigSchema = z.object({
  appToken: configString({ "x-secret": true }).describe(
    "Gotify Application Token",
  ),
});

type GotifyUserConfig = z.infer<typeof gotifyUserConfigSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instructions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const adminInstructions = `
## Configure Gotify Server

1. Deploy a [Gotify server](https://gotify.net/) or use an existing instance
2. Enter the server URL below (e.g., \`https://gotify.example.com\`)
3. Users will create their own application tokens in the Gotify web UI

> **Note**: Ensure the server URL is accessible from this Checkstack instance.
`.trim();

const userInstructions = `
## Get Your Gotify App Token

1. Log into your organization's Gotify server
2. Go to the **Apps** tab in the web interface
3. Click **Create Application**
4. Give it a name (e.g., "Checkstack Notifications")
5. Copy the generated **Token** and paste it in the field above

> **Tip**: You can customize the app icon in Gotify for easy identification.
`.trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Priority Mapping
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Maps notification importance to Gotify priority.
 * Gotify priorities: 0=min, 1-3=low, 4-7=normal, 8-10=high
 */
function mapImportanceToPriority(
  importance: "info" | "warning" | "critical",
): number {
  const priorityMap: Record<string, number> = {
    info: 5, // Normal
    warning: 7, // High-normal
    critical: 10, // Highest
  };
  return priorityMap[importance];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Gotify Strategy Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Gotify notification strategy using REST API.
 */
const gotifyStrategy: NotificationStrategy<GotifyConfig, GotifyUserConfig> = {
  id: "gotify",
  displayName: "Gotify",
  description: "Send notifications via Gotify self-hosted server",
  icon: "Bell",

  config: new Versioned({
    version: 1,
    schema: gotifyConfigSchemaV1,
  }),

  // User-config resolution - users enter their app token
  contactResolution: { type: "user-config", field: "appToken" },

  userConfig: new Versioned({
    version: 1,
    schema: gotifyUserConfigSchema,
  }),

  adminInstructions,
  userInstructions,

  async send(
    context: NotificationSendContext<GotifyConfig, GotifyUserConfig>,
  ): Promise<NotificationDeliveryResult> {
    const { userConfig, notification, strategyConfig, logger } = context;

    if (!strategyConfig.serverUrl) {
      return {
        success: false,
        error: "Gotify server URL not configured",
      };
    }

    if (!userConfig?.appToken) {
      return {
        success: false,
        error: "User has not configured their Gotify app token",
      };
    }

    // Build message body. Gotify treats `message` as plain text; subjects
    // append as a bulleted list with parenthesized URLs.
    let message = notification.body
      ? markdownToPlainText(notification.body)
      : notification.title;
    const subjectsText = renderSubjectsAsPlainText({
      subjects: notification.subjects ?? [],
    });
    if (subjectsText) {
      message += `\n\n${subjectsText}`;
    }

    // Add action URL to extras if present
    const extras: Record<string, unknown> = {};
    if (notification.action?.url) {
      extras["client::notification"] = {
        click: { url: notification.action.url },
      };
    }

    // Build request URL with token
    const serverUrl = strategyConfig.serverUrl.replace(/\/$/, "");
    const url = `${serverUrl}/message?token=${encodeURIComponent(userConfig.appToken)}`;

    // SSRF guard: the Gotify server URL is user-supplied. Reject it up front if
    // it resolves to an internal/reserved address, and refuse redirects below so
    // a server cannot 3xx us at an internal host past this pre-flight.
    const validation = await validateWebhookUrl({ url });
    if (!validation.ok) {
      logger.warn(`Blocked Gotify delivery to ${serverUrl}: ${validation.error}`);
      return { success: false, error: validation.error };
    }

    // Send to Gotify
    const result = await postJson({
      url,
      body: {
        title: notification.title,
        message,
        priority: mapImportanceToPriority(notification.importance),
        extras: Object.keys(extras).length > 0 ? extras : undefined,
      },
      redirect: "error",
      serviceName: "Gotify",
      logger,
    });
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const body = (await result.response.json()) as { id?: number };
    return {
      success: true,
      externalId: body.id ? String(body.id) : undefined,
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

    // Register the Gotify strategy with our plugin metadata
    extensionPoint.addStrategy(gotifyStrategy, pluginMetadata);
  },
});

/**
 * Internal exports for the package's own unit tests. Not part of the plugin's
 * public API surface.
 * @internal
 */
export {
  gotifyConfigSchemaV1,
  gotifyUserConfigSchema,
  mapImportanceToPriority,
  gotifyStrategy,
};
/** @internal */
export type { GotifyConfig, GotifyUserConfig };
