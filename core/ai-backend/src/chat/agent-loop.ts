import type { AuthUser } from "@checkstack/backend-api";
import type { AiToolResolver } from "../resolver";
import type { RegisteredAiTool } from "../tool-registry";

/**
 * Server-side agent-loop CORE (plan §4 / Phase 4) — provider-agnostic and
 * DOM-free, so the security-critical tool-gating logic is unit-testable without
 * a model, a browser, or the Vercel AI SDK.
 *
 * The loop treats the model as an UNTRUSTED caller (decision §1.5): it may only
 * invoke tools the resolver allows for the logged-in principal, and it may never
 * silently mutate. The decision of WHAT a model-requested tool call does is made
 * here, not by the SDK:
 *
 *  - `read` tools AUTO-RUN (handler-side authz still re-checks on execute).
 *  - `mutate` / `destructive` tools NEVER execute inline; they go through the
 *    propose/apply gate and surface a CONFIRM CARD the human must approve.
 *  - a tool the principal cannot see is REFUSED server-side, even if the model
 *    asks for it (the resolver never offered it, but the model is untrusted).
 */

/** What the agent loop should do with a model-requested tool call. */
export type AgentToolDisposition =
  | { kind: "run"; tool: RegisteredAiTool } // read tool: auto-run
  | { kind: "confirm"; tool: RegisteredAiTool } // mutate/destructive: propose + confirm card
  | { kind: "refused"; reason: string }; // unknown / not allowed

/**
 * The single server-side gate for a model-requested tool. Mirrors the MCP
 * `tools/call` gate so both transports treat the model identically.
 */
export function disposeAgentTool({
  toolName,
  principal,
  resolver,
  getTool,
}: {
  toolName: string;
  principal: AuthUser;
  resolver: AiToolResolver;
  getTool: (name: string) => RegisteredAiTool | undefined;
}): AgentToolDisposition {
  const tool = getTool(toolName);
  if (!tool) {
    return { kind: "refused", reason: `Unknown tool: ${toolName}` };
  }
  // The model is untrusted: re-check authorization server-side even though the
  // resolver only ever OFFERED allowed tools.
  if (!resolver.isAllowed({ principal, tool })) {
    return { kind: "refused", reason: `Forbidden: ${toolName}` };
  }
  if (tool.effect === "read") {
    return { kind: "run", tool };
  }
  // mutate / destructive: never inline; require human confirmation.
  return { kind: "confirm", tool };
}

/**
 * The set of tools the loop OFFERS the model for a principal. Identical to the
 * resolver output — the loop never widens it. Mutating/destructive tools are
 * offered too (so the model can REQUEST them), but their disposition is
 * `confirm`, never auto-run.
 */
export function offeredTools({
  principal,
  resolver,
}: {
  principal: AuthUser;
  resolver: AiToolResolver;
}): RegisteredAiTool[] {
  return resolver.resolveTools(principal);
}
