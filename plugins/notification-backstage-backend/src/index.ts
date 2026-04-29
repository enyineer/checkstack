import {
  createBackendPlugin,
  type NotificationStrategy,
  Versioned,
  configString,
  markdownToPlainText,
} from "@checkstack/backend-api";
import { notificationStrategyExtensionPoint } from "@checkstack/notification-backend";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";
import { extractErrorMessage } from "@checkstack/common";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Admin Configuration Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Backstage configuration schema with versioning support.
 * Admins configure the Backstage instance URL and access token.
 */
const backstageConfigSchemaV1 = z.object({
  baseUrl: configString({})
    .url()
    .optional()
    .describe(
      "Backstage instance base URL (e.g., https://backstage.example.com)",
    ),
  token: configString({ "x-secret": true })
    .optional()
    .describe("Backstage API access token for external service authentication"),
  defaultEntityPrefix: configString({})
    .optional()
    .default("user:default/")
    .describe("Default entity prefix for user mapping (e.g., user:default/)"),
});

type BackstageConfig = z.infer<typeof backstageConfigSchemaV1>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// User Configuration Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Per-user configuration for Backstage notifications.
 * Users can specify their entity reference in Backstage.
 */
const userConfigSchemaV1 = z.object({
  entityRef: configString({})
    .optional()
    .describe("Your Backstage entity reference (e.g., user:default/john.doe)"),
});

type BackstageUserConfig = z.infer<typeof userConfigSchemaV1>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instructions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const adminInstructions = `
## Backstage Configuration

Connect Checkstack to your Backstage instance to forward notifications.

### Prerequisites

1. Your Backstage instance must have the **notifications plugin** installed
2. You need to enable **external access** for the notifications API

### Setup Steps

1. Enable external service access in your Backstage instance
2. Generate a static access token (see [Backstage docs](https://backstage.io/docs/auth/service-to-service-auth))
3. Enter your Backstage instance URL (e.g., \`https://backstage.example.com\`)
4. Paste the access token in the **Token** field

> **Note**: The default entity prefix is used when users don't specify their own entity reference.
`.trim();

const userInstructions = `
## Connect to Backstage

Receive Checkstack notifications in your Backstage notification inbox.

### Find Your Entity Reference

Your entity reference is how Backstage identifies you. It typically follows the format:
- \`user:default/your.username\`
- \`user:default/your-email\`

You can find this in your Backstage profile or catalog.

> **Tip**: If you leave this blank, the system will try to use your email with the default prefix.
`.trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Severity Mapping
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Maps Checkstack importance levels to Backstage severity levels.
 */
function mapImportanceToSeverity(
  importance: "info" | "warning" | "critical",
): "low" | "normal" | "high" | "critical" {
  switch (importance) {
    case "info": {
      return "normal";
    }
    case "warning": {
      return "high";
    }
    case "critical": {
      return "critical";
    }
    default: {
      return "normal";
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Backstage Strategy Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const backstageStrategy: NotificationStrategy<
  BackstageConfig,
  BackstageUserConfig,
  undefined
> = {
  id: "backstage",
  displayName: "Backstage",
  description: "Send notifications to your Backstage developer portal",
  icon: "LayoutDashboard",

  config: new Versioned({
    version: 1,
    schema: backstageConfigSchemaV1,
  }),

  userConfig: new Versioned({
    version: 1,
    schema: userConfigSchemaV1,
  }),

  contactResolution: { type: "user-config", field: "entityRef" },

  adminInstructions,
  userInstructions,

  async send({
    contact,
    notification,
    strategyConfig,
    userConfig,
    user,
    logger,
  }) {
    // Validate required admin config
    if (!strategyConfig.baseUrl || !strategyConfig.token) {
      return {
        success: false,
        error:
          "Backstage is not configured. Please configure baseUrl and token.",
      };
    }

    // Determine the entity reference
    let entityRef = userConfig?.entityRef;

    // Fallback: construct from email using default prefix
    if (!entityRef && user.email) {
      const prefix = strategyConfig.defaultEntityPrefix ?? "user:default/";
      // Convert email to entity-safe format (replace @ and . with common patterns)
      const emailPart = user.email.split("@")[0]?.toLowerCase() ?? "";
      entityRef = `${prefix}${emailPart}`;
    }

    // Still no entity ref? Use the contact as-is (might be set by system)
    if (!entityRef) {
      entityRef = contact;
    }

    if (!entityRef) {
      return {
        success: false,
        error: "No Backstage entity reference configured for this user.",
      };
    }

    // Build the notification payload
    const description = notification.body
      ? markdownToPlainText(notification.body)
      : undefined;

    const payload = {
      recipients: {
        type: "entity" as const,
        entityRef,
      },
      payload: {
        title: notification.title,
        ...(description && { description }),
        ...(notification.action?.url && { link: notification.action.url }),
        severity: mapImportanceToSeverity(notification.importance),
        ...(notification.type && { topic: notification.type }),
      },
    };

    // Send to Backstage
    const url = `${strategyConfig.baseUrl.replace(
      /\/$/,
      "",
    )}/api/notifications/notifications`;

    try {
      logger?.debug?.("Sending notification to Backstage", {
        url,
        entityRef,
        title: notification.title,
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${strategyConfig.token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger?.error?.("Backstage API error", {
          status: response.status,
          error: errorText,
        });
        return {
          success: false,
          error: `Backstage API error: ${response.status} - ${errorText}`,
        };
      }

      // Try to extract notification ID from response
      let externalId: string | undefined;
      try {
        const result = (await response.json()) as { id?: string };
        externalId = result.id;
      } catch {
        // Response might not be JSON, that's ok
      }

      logger?.info?.("Notification sent to Backstage", {
        entityRef,
        externalId,
      });

      return {
        success: true,
        ...(externalId && { externalId }),
      };
    } catch (error) {
      logger?.error?.("Failed to send notification to Backstage", {
        error: extractErrorMessage(error),
      });
      return {
        success: false,
        error: extractErrorMessage(error),
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

    // Register the Backstage strategy with our plugin metadata
    extensionPoint.addStrategy(backstageStrategy, pluginMetadata);
  },
});

// Export for testing
export { backstageConfigSchemaV1, userConfigSchemaV1, mapImportanceToSeverity };
export type { BackstageConfig, BackstageUserConfig };
