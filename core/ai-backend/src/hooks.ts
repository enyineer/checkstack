import { createHook } from "@checkstack/backend-api";
import type { AiToolEffect } from "@checkstack/ai-common";

/**
 * Status reached by a tool call when the {@link aiHooks.toolCalled} hook fires.
 */
export type AiToolCalledStatus = "proposed" | "applied" | "executed" | "failed";

/**
 * Payload for the {@link aiHooks.toolCalled} event.
 *
 * Deliberately carries NO arguments and NO result body — only metadata. The
 * audit row (`ai_tool_calls`) stores a SHA-256 `argsHash`, never the raw args,
 * because they may carry PII or secrets (§10). Subscribers (notifications,
 * anomaly-context, etc.) react to the fact of a call, not its contents.
 */
export interface AiToolCalledPayload {
  principalKind: "user" | "application";
  principalId: string;
  transport: "chat" | "mcp" | "automation";
  toolName: string;
  effect: AiToolEffect;
  status: AiToolCalledStatus;
}

/**
 * AI platform hooks. Emitted on the shared event bus so subscribers on every
 * pod receive them (cluster-wide), independent of which pod ran the tool.
 */
export const aiHooks = {
  /** Emitted for every tool invocation (propose / apply / read). */
  toolCalled: createHook<AiToolCalledPayload>("ai.toolCalled"),
};
