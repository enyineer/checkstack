/**
 * Webex action — post a markdown message to a Webex room.
 *
 * Replaces the legacy `webexProvider.deliver`. Template expansion is
 * handled by the dispatch engine, so `config.markdown` is already the
 * final string by the time `execute` runs.
 */
import { z } from "zod";
import {
  configString,
  Versioned,
  type Logger,
} from "@checkstack/backend-api";
import type { ActionDefinition } from "@checkstack/automation-backend";
import { connectionStoreRef } from "@checkstack/integration-backend";
import { extractErrorMessage } from "@checkstack/common";

import { WEBEX_RESOLVERS, type WebexConnectionConfig } from "./provider";

const WEBEX_API_BASE = "https://webexapis.com/v1";

const webexMessageDataSchema = z.object({
  messageId: z.string(),
  roomId: z.string(),
});

export const webexMessageArtifactType = {
  id: "message",
  displayName: "Webex Message",
  description: "A message posted to a Webex room",
  schema: webexMessageDataSchema,
} as const;

const webexPostMessageConfigSchema = z.object({
  connectionId: configString({ "x-hidden": true }).describe("Webex connection"),
  roomId: configString({
    "x-options-resolver": WEBEX_RESOLVERS.ROOM_OPTIONS,
    "x-depends-on": ["connectionId"],
  }).describe("Target Webex space"),
  markdown: configString({ "x-editor-types": ["raw"] })
    .min(1)
    .describe("Markdown message body"),
});

type WebexPostMessageConfig = z.infer<typeof webexPostMessageConfigSchema>;

async function postWebexMessage(params: {
  botToken: string;
  roomId: string;
  markdown: string;
  logger: Logger;
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
        error: `Webex API error (${response.status}): ${errorText.slice(0, 200)}`,
      };
    }
    const data = (await response.json()) as { id: string };
    return { success: true, messageId: data.id };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error, "Unknown error") };
  }
}

export function createWebexActions(): ActionDefinition<unknown, unknown>[] {
  const postMessage: ActionDefinition<
    WebexPostMessageConfig,
    z.infer<typeof webexMessageDataSchema>
  > = {
    id: "post_message",
    displayName: "Post Webex Message",
    description: "Send a markdown message to a Webex space",
    category: "Webex",
    icon: "MessageSquare",
    config: new Versioned({
      version: 1,
      schema: webexPostMessageConfigSchema,
    }),
    produces: "message",
    // Fetch the connection store lazily here rather than baking it in
    // at registration time: integration-backend registers
    // `connectionStoreRef` inside its own `init()`, so the topological
    // sort can't statically order this plugin's init after that.
    execute: async ({ config, logger, getService }) => {
      const connectionStore = await getService(connectionStoreRef);
      const connection = await connectionStore.getConnectionWithCredentials(
        config.connectionId,
      );
      if (!connection) {
        return {
          success: false,
          error: `Webex connection not found: ${config.connectionId}`,
        };
      }
      const connConfig = connection.config as WebexConnectionConfig;
      const result = await postWebexMessage({
        botToken: connConfig.botToken,
        roomId: config.roomId,
        markdown: config.markdown,
        logger,
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }
      logger.info(`Posted Webex message ${result.messageId}`);
      return {
        success: true,
        externalId: result.messageId,
        artifact: { messageId: result.messageId, roomId: config.roomId },
      };
    },
  };
  return [postMessage as ActionDefinition<unknown, unknown>];
}
