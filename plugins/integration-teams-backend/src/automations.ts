/**
 * Teams action — post a message to a Microsoft Teams channel.
 *
 * Replaces the legacy `teamsProvider.deliver`. The operator now writes
 * the message body (with markdown/template support handled at the
 * dispatch-engine level); this action just wraps it in a minimal
 * Adaptive Card and posts it via the Graph API.
 */
import { z } from "zod";
import {
  configString,
  Versioned,
  type Logger,
} from "@checkstack/backend-api";
import type { ActionDefinition } from "@checkstack/automation-backend";
import { connectionStoreRef } from "@checkstack/integration-backend";
import {
  access,
  extractErrorMessage,
  qualifyAccessRuleId,
} from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

import {
  getAppToken,
  TEAMS_RESOLVERS,
  TEAMS_PROVIDER_QUALIFIED_ID,
  type TeamsConnectionConfig,
} from "./provider";

/**
 * Access rule a runAs service account must hold to post Teams messages from an
 * automation. The dispatch engine enforces it before the action runs, so the
 * capability is granted deliberately to a service account's role rather than
 * implied by being able to author automations.
 */
export const teamsAccess = {
  postMessage: access(
    "post_message",
    "manage",
    "Post Microsoft Teams messages from an automation",
    { pluginId: pluginMetadata.pluginId },
  ),
};
export const teamsAccessRules = Object.values(teamsAccess);

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";

const teamsMessageDataSchema = z.object({
  messageId: z.string(),
  teamId: z.string(),
  channelId: z.string(),
});

export const teamsMessageArtifactType = {
  id: "message",
  displayName: "Teams Message",
  description: "A message posted to a Teams channel",
  schema: teamsMessageDataSchema,
} as const;

const teamsPostMessageConfigSchema = z.object({
  connectionId: configString({
    "x-options-resolver": TEAMS_RESOLVERS.CONNECTION_OPTIONS,
  }).describe("Teams connection"),
  teamId: configString({
    "x-options-resolver": TEAMS_RESOLVERS.TEAM_OPTIONS,
    "x-depends-on": ["connectionId"],
  }).describe("Target Team"),
  channelId: configString({
    "x-options-resolver": TEAMS_RESOLVERS.CHANNEL_OPTIONS,
    "x-depends-on": ["connectionId", "teamId"],
  }).describe("Target Channel"),
  title: configString({ "x-editor-types": ["raw"] })
    .optional()
    .describe("Card title (optional)"),
  body: configString({ "x-editor-types": ["raw"] })
    .min(1)
    .describe("Message body — supports markdown"),
});

type TeamsPostMessageConfig = z.infer<typeof teamsPostMessageConfigSchema>;

function buildAdaptiveCard({
  title,
  body,
}: {
  title?: string;
  body: string;
}): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [];
  if (title) {
    elements.push({
      type: "TextBlock",
      text: title,
      weight: "bolder",
      size: "large",
      wrap: true,
    });
  }
  elements.push({
    type: "TextBlock",
    text: body,
    wrap: true,
  });
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: elements,
  };
}

async function postTeamsMessage(params: {
  token: string;
  teamId: string;
  channelId: string;
  card: Record<string, unknown>;
  logger: Logger;
}): Promise<
  { success: true; messageId: string } | { success: false; error: string }
> {
  try {
    const response = await fetch(
      `${GRAPH_API_BASE}/teams/${params.teamId}/channels/${params.channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.token}`,
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
              content: JSON.stringify(params.card),
            },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      const errorText = await response.text();
      params.logger.error("Teams Graph API error", {
        status: response.status,
        error: errorText.slice(0, 200),
      });
      return {
        success: false,
        error: `Graph API error (${response.status}): ${errorText.slice(0, 100)}`,
      };
    }
    const data = (await response.json()) as { id: string };
    return { success: true, messageId: data.id };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error, "Unknown error") };
  }
}

export function createTeamsActions(): ActionDefinition<unknown, unknown>[] {
  const postMessage: ActionDefinition<
    TeamsPostMessageConfig,
    z.infer<typeof teamsMessageDataSchema>
  > = {
    id: "post_message",
    displayName: "Post Teams Message",
    description: "Send a message to a Teams channel",
    category: "Microsoft Teams",
    icon: "MessageSquareMore",
    connectionProviderId: TEAMS_PROVIDER_QUALIFIED_ID,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, teamsAccess.postMessage),
    ],
    config: new Versioned({
      version: 1,
      schema: teamsPostMessageConfigSchema,
    }),
    produces: "message",
    // Fetch the connection store lazily here rather than baking it in
    // at registration time: integration-backend registers
    // `connectionStoreRef` inside its own `init()`, so the topological
    // sort can't statically order this plugin's init after that. By
    // execute time every plugin has finished init + afterPluginsReady,
    // so `getService(connectionStoreRef)` is always resolvable.
    execute: async ({ config, logger, getService }) => {
      const connectionStore = await getService(connectionStoreRef);
      const connection = await connectionStore.getConnectionWithCredentials(
        config.connectionId,
      );
      if (!connection) {
        return {
          success: false,
          error: `Teams connection not found: ${config.connectionId}`,
        };
      }
      const connConfig = connection.config as TeamsConnectionConfig;
      const tokenResult = await getAppToken(connConfig);
      if (!tokenResult.success) {
        return {
          success: false,
          error: `Authentication failed: ${tokenResult.error}`,
        };
      }
      const card = buildAdaptiveCard({
        title: config.title,
        body: config.body,
      });
      const result = await postTeamsMessage({
        token: tokenResult.token,
        teamId: config.teamId,
        channelId: config.channelId,
        card,
        logger,
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }
      logger.info(`Posted Teams message ${result.messageId}`);
      return {
        success: true,
        externalId: result.messageId,
        artifact: {
          messageId: result.messageId,
          teamId: config.teamId,
          channelId: config.channelId,
        },
      };
    },
  };
  return [postMessage as ActionDefinition<unknown, unknown>];
}
