import { z } from "zod";
import {
  createBackendPlugin,
  configString,
  Versioned,
  type NotificationStrategy,
  type NotificationSendContext,
  type NotificationDeliveryResult,
  type NotificationSubject,
  type StrategyOAuthConfig,
} from "@checkstack/backend-api";
import {
  notificationStrategyExtensionPoint,
  IMPORTANCE_EMOJI,
  renderSubjectLabel,
} from "@checkstack/notification-backend";
import { pluginMetadata } from "./plugin-metadata";
import { extractErrorMessage } from "@checkstack/common";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Configuration Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Admin configuration for Microsoft Teams strategy.
 * Uses Azure AD App for OAuth authentication.
 */
const teamsConfigSchemaV1 = z.object({
  tenantId: configString({}).describe("Azure AD Tenant ID"),
  clientId: configString({}).describe("Azure AD Application (Client) ID"),
  clientSecret: configString({ "x-secret": true }).describe(
    "Azure AD Client Secret",
  ),
});

type TeamsConfig = z.infer<typeof teamsConfigSchemaV1>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instructions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const adminInstructions = `
## Register an Azure AD Application

1. Go to [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID** (formerly Azure AD)
2. Navigate to **App registrations** → **New registration**
3. Fill in the application details:
   - **Name**: Your notification bot name (e.g., "Checkstack Alerts")
   - **Supported account types**: Choose based on your tenant requirements
   - **Redirect URI**: Select "Web" and enter: \`{YOUR_BASE_URL}/api/notification/oauth/callback/teams\`
4. Click **Register**

## Configure API Permissions

1. In your app registration, go to **API permissions**
2. Click **Add a permission** → **Microsoft Graph** → **Delegated permissions**
3. Add these permissions:
   - \`Chat.ReadWrite\` (to create and send to 1:1 chats)
   - \`User.Read\` (to get user information)
   - \`offline_access\` (for refresh tokens)
4. Click **Grant admin consent** if required by your organization

## Create Client Secret

1. Go to **Certificates & secrets** → **Client secrets** → **New client secret**
2. Enter a description and choose an expiration period
3. Click **Add** and copy the secret value immediately (it won't be shown again)

## Enter Credentials

Copy the following values from your app registration:
- **Tenant ID**: Found in **Overview** → **Directory (tenant) ID**
- **Client ID**: Found in **Overview** → **Application (client) ID**
- **Client Secret**: The value you just created
`.trim();

const userInstructions = `
## Connect Your Microsoft Account

1. Click the **Connect** button below
2. Sign in with your Microsoft work or school account
3. Review and accept the requested permissions
4. You'll be redirected back automatically

Once connected, you'll receive notifications as personal chat messages from the Checkstack bot in Microsoft Teams.

> **Note**: Make sure you're signed into the correct Microsoft account that has access to Microsoft Teams.
`.trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Microsoft Graph API Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Adaptive Card Builder
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface AdaptiveCardOptions {
  title: string;
  body?: string;
  importance: "info" | "warning" | "critical";
  action?: { label: string; url: string };
  subjects?: NotificationSubject[];
}

function buildAdaptiveCard(options: AdaptiveCardOptions): object {
  const { title, body, importance, action, subjects } = options;

  const importanceColors: Record<string, string> = {
    info: "accent",
    warning: "warning",
    critical: "attention",
  };


  const bodyElements: object[] = [
    {
      type: "TextBlock",
      text: `${IMPORTANCE_EMOJI[importance]} ${title}`,
      weight: "bolder",
      size: "large",
      wrap: true,
      color: importanceColors[importance],
    },
  ];

  if (body) {
    bodyElements.push({
      type: "TextBlock",
      text: body,
      wrap: true,
    });
  }

  if (subjects && subjects.length > 0) {
    // Affected entities rendered as a FactSet — names link to URLs when
    // present; status maps to a colored circle.
    bodyElements.push(
      {
        type: "TextBlock",
        text: "**Affected**",
        weight: "bolder",
        spacing: "medium",
        wrap: true,
      },
      {
        type: "FactSet",
        facts: subjects.map((subject) => ({
          // Subject label (status emoji or bullet + name) is single-sourced via
          // the shared helper; the URL stays in the FactSet value column.
          title: renderSubjectLabel({ subject }),
          value: subject.url ? `[Open](${subject.url})` : "—",
        })),
      },
    );
  }

  const card: Record<string, unknown> = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: bodyElements,
  };

  if (action?.url) {
    card.actions = [
      {
        type: "Action.OpenUrl",
        title: action.label,
        url: action.url,
      },
    ];
  }

  return card;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Teams Strategy Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Microsoft Teams notification strategy.
 * Sends notifications as personal chat messages via Microsoft Graph API.
 */
const teamsStrategy: NotificationStrategy<TeamsConfig> = {
  id: "teams",
  displayName: "Microsoft Teams",
  description: "Send notifications via Microsoft Teams personal chat",
  icon: "MessageSquareMore",

  config: new Versioned({
    version: 1,
    schema: teamsConfigSchemaV1,
  }),

  // OAuth-based resolution - users authenticate via Microsoft
  contactResolution: { type: "oauth-link" },

  adminInstructions,
  userInstructions,

  // OAuth configuration for Microsoft identity platform
  // All functions receive the strategy config - no module-scoped variables needed
  oauth: {
    clientId: (config) => config.clientId ?? "",
    clientSecret: (config) => config.clientSecret ?? "",
    scopes: ["Chat.ReadWrite", "User.Read", "offline_access"],
    authorizationUrl: (config) => {
      // "common" works for multi-tenant Azure AD apps
      const tenantId = config.tenantId ?? "common";
      return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
    },
    tokenUrl: (config) => {
      const tenantId = config.tenantId ?? "common";
      return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    },
    extractExternalId: (response: Record<string, unknown>) => {
      // Microsoft returns user info we need to extract from Graph API
      // The ID token contains the user's object ID
      const idTokenClaims = response.id_token as string | undefined;
      if (idTokenClaims) {
        try {
          // Decode JWT payload (base64url)
          const parts = idTokenClaims.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(
              Buffer.from(parts[1], "base64url").toString(),
            ) as { oid?: string };
            if (payload.oid) {
              return payload.oid;
            }
          }
        } catch {
          // Fall through to use sub claim
        }
      }
      // Fallback to access token parsing or sub claim
      const sub = response.sub as string | undefined;
      return sub ?? "";
    },
    extractAccessToken: (response: Record<string, unknown>) =>
      response.access_token as string,
    extractRefreshToken: (response: Record<string, unknown>) =>
      response.refresh_token as string | undefined,
    extractExpiresIn: (response: Record<string, unknown>) =>
      response.expires_in as number | undefined,
  } satisfies StrategyOAuthConfig<TeamsConfig>,

  async send(
    context: NotificationSendContext<TeamsConfig>,
  ): Promise<NotificationDeliveryResult> {
    const { notification, strategyConfig, logger } = context;

    if (!strategyConfig.clientId || !strategyConfig.clientSecret) {
      return {
        success: false,
        error: "Microsoft Teams OAuth not configured",
      };
    }

    // Get the user's access token from context (provided by OAuth system)
    const oauthContext = context as unknown as {
      accessToken?: string;
      externalId?: string;
    };

    if (!oauthContext.accessToken) {
      return {
        success: false,
        error: "User has not connected their Microsoft account",
      };
    }

    if (!oauthContext.externalId) {
      return {
        success: false,
        error: "Could not determine user's Microsoft ID",
      };
    }

    try {
      // Step 1: Create or get the 1:1 chat with the user
      const chatResponse = await fetch(`${GRAPH_API_BASE}/chats`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauthContext.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatType: "oneOnOne",
          members: [
            {
              "@odata.type": "#microsoft.graph.aadUserConversationMember",
              roles: ["owner"],
              "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${oauthContext.externalId}')`,
            },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!chatResponse.ok) {
        const errorText = await chatResponse.text();
        logger.error("Failed to create/get Teams chat", {
          status: chatResponse.status,
          error: errorText.slice(0, 500),
        });
        return {
          success: false,
          error: `Failed to create Teams chat: ${chatResponse.status}`,
        };
      }

      const chatData = (await chatResponse.json()) as { id: string };
      const chatId = chatData.id;

      // Step 2: Build adaptive card for the message
      const card = buildAdaptiveCard({
        title: notification.title,
        body: notification.body,
        importance: notification.importance,
        action: notification.action,
        subjects: notification.subjects,
      });

      // Step 3: Send message to the chat
      const messageResponse = await fetch(
        `${GRAPH_API_BASE}/chats/${chatId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${oauthContext.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            body: {
              contentType: "html",
              content: `<attachment id="adaptiveCard"></attachment>`,
            },
            attachments: [
              {
                id: "adaptiveCard",
                contentType: "application/vnd.microsoft.card.adaptive",
                content: JSON.stringify(card),
              },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!messageResponse.ok) {
        const errorText = await messageResponse.text();
        logger.error("Failed to send Teams message", {
          status: messageResponse.status,
          error: errorText.slice(0, 500),
        });
        return {
          success: false,
          error: `Failed to send Teams message: ${messageResponse.status}`,
        };
      }

      const messageData = (await messageResponse.json()) as { id: string };

      return {
        success: true,
        externalId: messageData.id,
      };
    } catch (error) {
      const message = extractErrorMessage(error, "Unknown Graph API error");
      logger.error("Teams notification error", { error: message });
      return {
        success: false,
        error: `Failed to send Teams notification: ${message}`,
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

    // Register the Teams strategy with our plugin metadata
    extensionPoint.addStrategy(teamsStrategy, pluginMetadata);
  },
});

/**
 * Internal exports for the package's own unit tests. Not part of the plugin's
 * public API surface.
 * @internal
 */
export { teamsConfigSchemaV1, buildAdaptiveCard };
/** @internal */
export type { TeamsConfig, AdaptiveCardOptions };
