import { z } from "zod";
import { configString, Versioned } from "@checkmate-monitor/backend-api";
import type {
  IntegrationProvider,
  IntegrationDeliveryContext,
  IntegrationDeliveryResult,
  GetConnectionOptionsParams,
  ConnectionOption,
  TestConnectionResult,
} from "@checkmate-monitor/integration-backend";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Resolver Names
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WEBEX_RESOLVERS = {
  ROOM_OPTIONS: "roomOptions",
} as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Configuration Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Connection configuration - site-wide Webex Bot credentials.
 */
export const WebexConnectionSchema = z.object({
  botToken: configString({ "x-secret": true }).describe(
    "Webex Bot Access Token from developer.webex.com"
  ),
});

export type WebexConnectionConfig = z.infer<typeof WebexConnectionSchema>;

/**
 * Subscription configuration - which Webex room to send events to.
 */
export const WebexSubscriptionSchema = z.object({
  connectionId: configString({ "x-hidden": true }).describe("Webex connection"),
  roomId: configString({
    "x-options-resolver": WEBEX_RESOLVERS.ROOM_OPTIONS,
    "x-depends-on": ["connectionId"],
  }).describe("Target Webex Space"),
  messageTemplate: z
    .string()
    .optional()
    .describe(
      "Message template (supports {{event.payload.*}} placeholders). Leave empty for default format."
    ),
});

export type WebexSubscriptionConfig = z.infer<typeof WebexSubscriptionSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Webex API Client
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WEBEX_API_BASE = "https://webexapis.com/v1";

interface WebexRoom {
  id: string;
  title: string;
  type: "direct" | "group";
}

interface WebexRoomsResponse {
  items: WebexRoom[];
}

interface WebexMeResponse {
  id: string;
  displayName: string;
}

interface WebexMessageResponse {
  id: string;
}

async function fetchWebexRooms(
  botToken: string
): Promise<
  { success: true; rooms: WebexRoom[] } | { success: false; error: string }
> {
  try {
    const response = await fetch(`${WEBEX_API_BASE}/rooms?type=group&max=100`, {
      headers: {
        Authorization: `Bearer ${botToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { success: false, error: `Webex API error: ${response.status}` };
    }

    const data = (await response.json()) as WebexRoomsResponse;
    return { success: true, rooms: data.items ?? [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

async function sendWebexMessage(params: {
  botToken: string;
  roomId: string;
  markdown: string;
}): Promise<
  { success: true; messageId: string } | { success: false; error: string }
> {
  try {
    const response = await fetch(`${WEBEX_API_BASE}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        roomId: params.roomId,
        markdown: params.markdown,
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

    const data = (await response.json()) as WebexMessageResponse;
    return { success: true, messageId: data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

async function testWebexConnection(
  botToken: string
): Promise<
  { success: true; botName: string } | { success: false; error: string }
> {
  try {
    const response = await fetch(`${WEBEX_API_BASE}/people/me`, {
      headers: {
        Authorization: `Bearer ${botToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { success: false, error: `Webex API error: ${response.status}` };
    }

    const data = (await response.json()) as WebexMeResponse;
    return { success: true, botName: data.displayName };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Template Expansion
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function expandTemplate(
  template: string,
  context: Record<string, unknown>
): string {
  return template.replaceAll(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const trimmedPath = path.trim();
    const parts = trimmedPath.split(".");
    let value: unknown = context;
    for (const part of parts) {
      if (value === null || value === undefined) {
        return "";
      }
      value = (value as Record<string, unknown>)[part];
    }
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

function buildDefaultMessage(
  eventId: string,
  payload: Record<string, unknown>,
  subscriptionName: string
): string {
  const lines: string[] = [
    `📢 **Integration Event**`,
    `**Event:** ${eventId}`,
    `**Subscription:** ${subscriptionName}`,
    ``,
    `**Payload:**`,
    "```json",
    JSON.stringify(payload, undefined, 2),
    "```",
  ];
  return lines.join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provider Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const webexProvider: IntegrationProvider<
  WebexSubscriptionConfig,
  WebexConnectionConfig
> = {
  id: "webex",
  displayName: "Webex",
  description: "Send integration events to Webex team spaces",
  icon: "MessageSquare",

  config: new Versioned({
    version: 1,
    schema: WebexSubscriptionSchema,
  }),

  connectionSchema: new Versioned({
    version: 1,
    schema: WebexConnectionSchema,
  }),

  documentation: {
    setupGuide: `
## Create a Webex Bot

1. Go to [developer.webex.com](https://developer.webex.com/) and sign in
2. Navigate to **My Webex Apps** → **Create a New App** → **Create a Bot**
3. Fill in the bot details and create
4. Copy the **Bot Access Token** (shown only once)

## Add Bot to Spaces

1. In the Webex app, open the space where you want to receive events
2. Click the **Add People** button
3. Search for your bot's username and add it

> **Note**: The bot must be a member of a space to send messages there.
    `.trim(),
  },

  async getConnectionOptions(
    params: GetConnectionOptionsParams
  ): Promise<ConnectionOption[]> {
    const { resolverName, connectionId, getConnectionWithCredentials } = params;

    if (resolverName !== WEBEX_RESOLVERS.ROOM_OPTIONS) {
      return [];
    }

    // Get connection credentials
    const connection = await getConnectionWithCredentials(connectionId);
    if (!connection) {
      return [];
    }

    const config = connection.config as WebexConnectionConfig;
    const result = await fetchWebexRooms(config.botToken);

    if (!result.success) {
      return [];
    }

    return result.rooms.map((room) => ({
      value: room.id,
      label: room.title,
    }));
  },

  async testConnection(config: unknown): Promise<TestConnectionResult> {
    try {
      const parsedConfig = WebexConnectionSchema.parse(config);
      const result = await testWebexConnection(parsedConfig.botToken);

      return result.success
        ? {
            success: true,
            message: `Connected as bot: ${result.botName}`,
          }
        : {
            success: false,
            message: `Connection failed: ${result.error}`,
          };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid configuration";
      return {
        success: false,
        message: `Validation failed: ${message}`,
      };
    }
  },

  async deliver(
    context: IntegrationDeliveryContext<WebexSubscriptionConfig>
  ): Promise<IntegrationDeliveryResult> {
    const { event, subscription, providerConfig, logger } = context;

    // Parse and validate config
    const config = WebexSubscriptionSchema.parse(providerConfig);

    // Get connection with credentials
    if (!context.getConnectionWithCredentials) {
      return {
        success: false,
        error: "Connection credentials not available",
      };
    }

    const connection = await context.getConnectionWithCredentials(
      config.connectionId
    );

    if (!connection) {
      return {
        success: false,
        error: `Connection not found: ${config.connectionId}`,
      };
    }

    const connectionConfig = connection.config as WebexConnectionConfig;

    // Build message
    let markdown: string;
    if (config.messageTemplate) {
      const templateContext = {
        event: {
          eventId: event.eventId,
          payload: event.payload,
          timestamp: event.timestamp,
          deliveryId: event.deliveryId,
        },
        subscription: {
          id: subscription.id,
          name: subscription.name,
        },
      };
      markdown = expandTemplate(config.messageTemplate, templateContext);
    } else {
      markdown = buildDefaultMessage(
        event.eventId,
        event.payload as Record<string, unknown>,
        subscription.name
      );
    }

    // Send message
    const result = await sendWebexMessage({
      botToken: connectionConfig.botToken,
      roomId: config.roomId,
      markdown,
    });

    if (result.success) {
      logger.info("Webex message sent", { messageId: result.messageId });
      return {
        success: true,
        externalId: result.messageId,
      };
    } else {
      logger.error("Failed to send Webex message", { error: result.error });
      return {
        success: false,
        error: result.error,
      };
    }
  },
};
