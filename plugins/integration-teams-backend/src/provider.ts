import { z } from "zod";
import { configString, configSecret, Versioned } from "@checkstack/backend-api";
import type {
  ConnectionOption,
  GetConnectionOptionsParams,
  IntegrationProvider,
  TestConnectionResult,
} from "@checkstack/integration-backend";
import { extractErrorMessage } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

// ─── Provider id ─────────────────────────────────────────────────────────

/** Local provider id (namespaced on registration to `{pluginId}.{id}`). */
export const TEAMS_PROVIDER_LOCAL_ID = "teams";

/**
 * Fully-qualified Teams provider id (`integration-teams.teams`). Derived from
 * the plugin's own `pluginMetadata` so it tracks the plugin id rather than a
 * hardcoded string. Automation actions set this as `connectionProviderId` so
 * the editor knows which integration provider backs their dropdowns, and it
 * matches the `qualifiedId` the integration provider registry assigns.
 */
export const TEAMS_PROVIDER_QUALIFIED_ID = `${pluginMetadata.pluginId}.${TEAMS_PROVIDER_LOCAL_ID}`;

// ─── Resolver names ─────────────────────────────────────────────────────

export const TEAMS_RESOLVERS = {
  /**
   * Site-wide Teams connections. Drives the connection picker on the Teams
   * action; the editor bridge resolves it via `listConnections` (no
   * connection is selected yet), not `getConnectionOptions`.
   */
  CONNECTION_OPTIONS: "connectionOptions",
  TEAM_OPTIONS: "teamOptions",
  CHANNEL_OPTIONS: "channelOptions",
} as const;

// ─── Connection schema ──────────────────────────────────────────────────

export const TeamsConnectionSchema = z.object({
  tenantId: configString({}).describe("Azure AD Tenant ID"),
  clientId: configString({}).describe("Azure AD Application (Client) ID"),
  clientSecret: configSecret({ id: "clientSecret" }).describe(
    "Azure AD Client Secret",
  ),
});

export type TeamsConnectionConfig = z.infer<typeof TeamsConnectionSchema>;

// ─── Graph API helpers ──────────────────────────────────────────────────

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";

interface GraphTeam {
  id: string;
  displayName: string;
}

interface GraphChannel {
  id: string;
  displayName: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Get an app-only access token using client credentials flow.
 *
 * Exported for `automations.ts` so the post-message action can reuse
 * it without duplicating the OAuth dance.
 */
export async function getAppToken(
  config: TeamsConnectionConfig,
): Promise<
  { success: true; token: string } | { success: false; error: string }
> {
  try {
    const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
        error: `Token request failed (${response.status}): ${errorText.slice(0, 200)}`,
      };
    }
    const data = (await response.json()) as TokenResponse;
    return { success: true, token: data.access_token };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error, "Unknown error") };
  }
}

async function fetchTeams(
  token: string,
): Promise<
  { success: true; teams: GraphTeam[] } | { success: false; error: string }
> {
  try {
    const response = await fetch(`${GRAPH_API_BASE}/teams`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { success: false, error: `Graph API error: ${response.status}` };
    }
    const data = (await response.json()) as { value: GraphTeam[] };
    return { success: true, teams: data.value ?? [] };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error, "Unknown error") };
  }
}

async function fetchChannels(
  token: string,
  teamId: string,
): Promise<
  { success: true; channels: GraphChannel[] } | { success: false; error: string }
> {
  try {
    const response = await fetch(`${GRAPH_API_BASE}/teams/${teamId}/channels`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { success: false, error: `Graph API error: ${response.status}` };
    }
    const data = (await response.json()) as { value: GraphChannel[] };
    return { success: true, channels: data.value ?? [] };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error, "Unknown error") };
  }
}

// ─── Provider definition (connection-only) ──────────────────────────────

export const teamsProvider: IntegrationProvider<TeamsConnectionConfig> = {
  id: TEAMS_PROVIDER_LOCAL_ID,
  displayName: "Microsoft Teams",
  description: "Send automation messages to Microsoft Teams channels",
  icon: "MessageSquareMore",

  connectionSchema: new Versioned({
    version: 1,
    schema: TeamsConnectionSchema,
  }),

  documentation: {
    setupGuide: `
## Register an Azure AD Application

1. Go to [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID**
2. **App registrations** → **New registration**, register the app

## Configure API Permissions

1. **API permissions** → **Add a permission** → **Microsoft Graph**
2. **Application permissions** (not Delegated)
3. Add: \`Team.ReadBasic.All\`, \`Channel.ReadBasic.All\`, \`ChannelMessage.Send\`
4. **Grant admin consent**

## Create Client Secret

1. **Certificates & secrets** → **New client secret**
2. Copy the secret value immediately
    `.trim(),
  },

  async getConnectionOptions(
    params: GetConnectionOptionsParams,
  ): Promise<ConnectionOption[]> {
    const { resolverName, connectionId, context, getConnectionWithCredentials } =
      params;
    const connection = await getConnectionWithCredentials(connectionId);
    if (!connection) return [];
    const config = connection.config as TeamsConnectionConfig;
    const tokenResult = await getAppToken(config);
    if (!tokenResult.success) return [];

    if (resolverName === TEAMS_RESOLVERS.TEAM_OPTIONS) {
      const result = await fetchTeams(tokenResult.token);
      if (!result.success) return [];
      return result.teams.map((team) => ({
        value: team.id,
        label: team.displayName,
      }));
    }

    if (resolverName === TEAMS_RESOLVERS.CHANNEL_OPTIONS) {
      const teamId = context?.teamId as string | undefined;
      if (!teamId) return [];
      const result = await fetchChannels(tokenResult.token, teamId);
      if (!result.success) return [];
      return result.channels.map((channel) => ({
        value: channel.id,
        label: channel.displayName,
      }));
    }
    return [];
  },

  async testConnection(config): Promise<TestConnectionResult> {
    try {
      const parsedConfig = TeamsConnectionSchema.parse(config);
      const tokenResult = await getAppToken(parsedConfig);
      if (!tokenResult.success) {
        return {
          success: false,
          message: `Authentication failed: ${tokenResult.error}`,
        };
      }
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
      return {
        success: false,
        message: `Validation failed: ${extractErrorMessage(error, "Invalid configuration")}`,
      };
    }
  },
};
