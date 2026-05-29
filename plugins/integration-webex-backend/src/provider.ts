import { z } from "zod";
import { configString, Versioned } from "@checkstack/backend-api";
import type {
  IntegrationProvider,
  GetConnectionOptionsParams,
  ConnectionOption,
  TestConnectionResult,
} from "@checkstack/integration-backend";
import { extractErrorMessage } from "@checkstack/common";

// ─── Resolver names ─────────────────────────────────────────────────────

export const WEBEX_RESOLVERS = {
  ROOM_OPTIONS: "roomOptions",
} as const;

// ─── Connection schema ──────────────────────────────────────────────────

export const WebexConnectionSchema = z.object({
  botToken: configString({ "x-secret": true }).describe(
    "Webex Bot Access Token from developer.webex.com",
  ),
});

export type WebexConnectionConfig = z.infer<typeof WebexConnectionSchema>;

// ─── Webex API helpers ──────────────────────────────────────────────────

const WEBEX_API_BASE = "https://webexapis.com/v1";

interface WebexRoom {
  id: string;
  title: string;
  type: "direct" | "group";
}

async function fetchWebexRooms(
  botToken: string,
): Promise<
  { success: true; rooms: WebexRoom[] } | { success: false; error: string }
> {
  try {
    const response = await fetch(`${WEBEX_API_BASE}/rooms?type=group&max=100`, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { success: false, error: `Webex API error: ${response.status}` };
    }
    const data = (await response.json()) as { items: WebexRoom[] };
    return { success: true, rooms: data.items ?? [] };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error, "Unknown error") };
  }
}

async function testWebexConnection(
  botToken: string,
): Promise<
  { success: true; botName: string } | { success: false; error: string }
> {
  try {
    const response = await fetch(`${WEBEX_API_BASE}/people/me`, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { success: false, error: `Webex API error: ${response.status}` };
    }
    const data = (await response.json()) as { displayName: string };
    return { success: true, botName: data.displayName };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error, "Unknown error") };
  }
}

// ─── Provider definition (connection-only) ──────────────────────────────

export const webexProvider: IntegrationProvider<WebexConnectionConfig> = {
  id: "webex",
  displayName: "Webex",
  description: "Send automation messages to Webex team spaces",
  icon: "MessageSquare",

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

1. In the Webex app, open the space where you want to receive messages
2. Click the **Add People** button
3. Search for your bot's username and add it
    `.trim(),
  },

  async getConnectionOptions(
    params: GetConnectionOptionsParams,
  ): Promise<ConnectionOption[]> {
    const { resolverName, connectionId, getConnectionWithCredentials } = params;
    if (resolverName !== WEBEX_RESOLVERS.ROOM_OPTIONS) return [];
    const connection = await getConnectionWithCredentials(connectionId);
    if (!connection) return [];
    const config = connection.config as WebexConnectionConfig;
    const result = await fetchWebexRooms(config.botToken);
    if (!result.success) return [];
    return result.rooms.map((room) => ({ value: room.id, label: room.title }));
  },

  async testConnection(config): Promise<TestConnectionResult> {
    try {
      const parsedConfig = WebexConnectionSchema.parse(config);
      const result = await testWebexConnection(parsedConfig.botToken);
      return result.success
        ? { success: true, message: `Connected as bot: ${result.botName}` }
        : { success: false, message: `Connection failed: ${result.error}` };
    } catch (error) {
      return {
        success: false,
        message: `Validation failed: ${extractErrorMessage(error, "Invalid configuration")}`,
      };
    }
  },
};
