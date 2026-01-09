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

const TEAMS_RESOLVERS = {
  TEAM_OPTIONS: "teamOptions",
  CHANNEL_OPTIONS: "channelOptions",
} as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Configuration Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Connection configuration - Azure AD App credentials for Graph API.
 */
export const TeamsConnectionSchema = z.object({
  tenantId: configString({}).describe("Azure AD Tenant ID"),
  clientId: configString({}).describe("Azure AD Application (Client) ID"),
  clientSecret: configString({ "x-secret": true }).describe(
    "Azure AD Client Secret"
  ),
});

export type TeamsConnectionConfig = z.infer<typeof TeamsConnectionSchema>;

/**
 * Subscription configuration - which Teams channel to send events to.
 */
export const TeamsSubscriptionSchema = z.object({
  connectionId: configString({ "x-hidden": true }).describe("Teams connection"),
  teamId: configString({
    "x-options-resolver": TEAMS_RESOLVERS.TEAM_OPTIONS,
    "x-depends-on": ["connectionId"],
  }).describe("Target Team"),
  channelId: configString({
    "x-options-resolver": TEAMS_RESOLVERS.CHANNEL_OPTIONS,
    "x-depends-on": ["connectionId", "teamId"],
  }).describe("Target Channel"),
});

export type TeamsSubscriptionConfig = z.infer<typeof TeamsSubscriptionSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Graph API Types and Client
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";

interface GraphTeam {
  id: string;
  displayName: string;
}

interface GraphChannel {
  id: string;
  displayName: string;
}

interface GraphTeamsResponse {
  value: GraphTeam[];
}

interface GraphChannelsResponse {
  value: GraphChannel[];
}

interface GraphMessageResponse {
  id: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Get an app-only access token using client credentials flow.
 */
async function getAppToken(
  config: TeamsConnectionConfig
): Promise<
  { success: true; token: string } | { success: false; error: string }
> {
  try {
    const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Token request failed (${response.status}): ${errorText.slice(
          0,
          200
        )}`,
      };
    }

    const data = (await response.json()) as TokenResponse;
    return { success: true, token: data.access_token };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

async function fetchTeams(
  token: string
): Promise<
  { success: true; teams: GraphTeam[] } | { success: false; error: string }
> {
  try {
    const response = await fetch(`${GRAPH_API_BASE}/teams`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { success: false, error: `Graph API error: ${response.status}` };
    }

    const data = (await response.json()) as GraphTeamsResponse;
    return { success: true, teams: data.value ?? [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

async function fetchChannels(
  token: string,
  teamId: string
): Promise<
  | { success: true; channels: GraphChannel[] }
  | { success: false; error: string }
> {
  try {
    const response = await fetch(`${GRAPH_API_BASE}/teams/${teamId}/channels`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { success: false, error: `Graph API error: ${response.status}` };
    }

    const data = (await response.json()) as GraphChannelsResponse;
    return { success: true, channels: data.value ?? [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Adaptive Card Builder
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface AdaptiveCardOptions {
  eventId: string;
  payload: Record<string, unknown>;
  subscriptionName: string;
  timestamp: string;
}

export function buildAdaptiveCard(options: AdaptiveCardOptions): object {
  const { eventId, payload, subscriptionName, timestamp } = options;

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        text: `📢 Integration Event`,
        weight: "bolder",
        size: "large",
        wrap: true,
      },
      {
        type: "FactSet",
        facts: [
          { title: "Event", value: eventId },
          { title: "Subscription", value: subscriptionName },
          { title: "Time", value: new Date(timestamp).toLocaleString() },
        ],
      },
      {
        type: "TextBlock",
        text: "**Payload:**",
        weight: "bolder",
        spacing: "medium",
      },
      {
        type: "TextBlock",
        // eslint-disable-next-line unicorn/no-null
        text: "```\n" + JSON.stringify(payload, null, 2) + "\n```",
        wrap: true,
        fontType: "monospace",
        size: "small",
      },
    ],
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provider Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const teamsProvider: IntegrationProvider<
  TeamsSubscriptionConfig,
  TeamsConnectionConfig
> = {
  id: "teams",
  displayName: "Microsoft Teams",
  description: "Send integration events to Microsoft Teams channels",
  icon: "MessageSquareMore",

  config: new Versioned({
    version: 1,
    schema: TeamsSubscriptionSchema,
  }),

  connectionSchema: new Versioned({
    version: 1,
    schema: TeamsConnectionSchema,
  }),

  documentation: {
    setupGuide: `
## Register an Azure AD Application

1. Go to [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID**
2. Navigate to **App registrations** → **New registration**
3. Fill in details and register

## Configure API Permissions

1. Go to **API permissions** → **Add a permission** → **Microsoft Graph**
2. Select **Application permissions** (not Delegated)
3. Add these permissions:
   - \`Team.ReadBasic.All\` (to list teams)
   - \`Channel.ReadBasic.All\` (to list channels)
   - \`ChannelMessage.Send\` (to send messages)
4. Click **Grant admin consent**

## Create Client Secret

1. Go to **Certificates & secrets** → **New client secret**
2. Copy the secret value immediately

## Add App to Teams

For the app to send messages, it must be installed in the target Team:
1. Create a Teams app manifest or use Graph API to install
2. Alternatively, ensure the app has \`ChannelMessage.Send\` consent
    `.trim(),
  },

  async getConnectionOptions(
    params: GetConnectionOptionsParams
  ): Promise<ConnectionOption[]> {
    const {
      resolverName,
      connectionId,
      context,
      getConnectionWithCredentials,
    } = params;

    // Get connection credentials
    const connection = await getConnectionWithCredentials(connectionId);
    if (!connection) {
      return [];
    }

    const config = connection.config as TeamsConnectionConfig;

    // Get app token
    const tokenResult = await getAppToken(config);
    if (!tokenResult.success) {
      return [];
    }

    if (resolverName === TEAMS_RESOLVERS.TEAM_OPTIONS) {
      const result = await fetchTeams(tokenResult.token);
      if (!result.success) {
        return [];
      }
      return result.teams.map((team) => ({
        value: team.id,
        label: team.displayName,
      }));
    }

    if (resolverName === TEAMS_RESOLVERS.CHANNEL_OPTIONS) {
      const teamId = (context as Partial<TeamsSubscriptionConfig>)?.teamId;
      if (!teamId) {
        return [];
      }

      const result = await fetchChannels(tokenResult.token, teamId);
      if (!result.success) {
        return [];
      }
      return result.channels.map((channel) => ({
        value: channel.id,
        label: channel.displayName,
      }));
    }

    return [];
  },

  async testConnection(config: unknown): Promise<TestConnectionResult> {
    try {
      const parsedConfig = TeamsConnectionSchema.parse(config);
      const tokenResult = await getAppToken(parsedConfig);

      if (!tokenResult.success) {
        return {
          success: false,
          message: `Authentication failed: ${tokenResult.error}`,
        };
      }

      // Verify we can list teams
      const teamsResult = await fetchTeams(tokenResult.token);
      if (!teamsResult.success) {
        return {
          success: false,
          message: `API access failed: ${teamsResult.error}`,
        };
      }

      return {
        success: true,
        message: `Connected successfully. Found ${teamsResult.teams.length} team(s).`,
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
    context: IntegrationDeliveryContext<TeamsSubscriptionConfig>
  ): Promise<IntegrationDeliveryResult> {
    const { event, subscription, providerConfig, logger } = context;

    // Parse and validate config
    const config = TeamsSubscriptionSchema.parse(providerConfig);

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

    const connectionConfig = connection.config as TeamsConnectionConfig;

    // Get app token
    const tokenResult = await getAppToken(connectionConfig);
    if (!tokenResult.success) {
      logger.error("Failed to get Graph API token", {
        error: tokenResult.error,
      });
      return {
        success: false,
        error: `Authentication failed: ${tokenResult.error}`,
      };
    }

    // Build Adaptive Card
    const adaptiveCard = buildAdaptiveCard({
      eventId: event.eventId,
      payload: event.payload as Record<string, unknown>,
      subscriptionName: subscription.name,
      timestamp: event.timestamp,
    });

    // Send message to channel
    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/teams/${config.teamId}/channels/${config.channelId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenResult.token}`,
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
                content: JSON.stringify(adaptiveCard),
              },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Failed to send Teams message", {
          status: response.status,
          error: errorText.slice(0, 200),
        });
        return {
          success: false,
          error: `Graph API error (${response.status}): ${errorText.slice(
            0,
            100
          )}`,
        };
      }

      const messageData = (await response.json()) as GraphMessageResponse;

      logger.info("Teams message sent", { messageId: messageData.id });
      return {
        success: true,
        externalId: messageData.id,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Graph API error";
      logger.error("Teams delivery error", { error: message });
      return {
        success: false,
        error: `Failed to send Teams message: ${message}`,
      };
    }
  },
};
