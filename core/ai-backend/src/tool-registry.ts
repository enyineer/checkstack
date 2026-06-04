import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import type { AiTool } from "@checkstack/ai-common";

/**
 * A tool whose executors run with a Checkstack {@link AuthUser} principal and
 * receive a USER-SCOPED {@link RpcClient} (bound to the originating user) for any
 * plugin call - so handler-side authz + per-resource/team scoping always apply.
 */
export type RegisteredAiTool<TInput = unknown, TOutput = unknown> = AiTool<
  TInput,
  TOutput,
  AuthUser,
  RpcClient
>;

/**
 * Registry for AI tools — the spine of the AI platform. Plugins contribute
 * tools through `aiToolExtensionPoint` (hand-authored composite tools) and
 * `aiToolProjectionExtensionPoint` (opt-in projections of existing oRPC
 * procedures). Both transports (chat, MCP) resolve tools from this one
 * registry, so no capability is implemented twice.
 *
 * Tool names are already fully qualified (`<plugin>.<tool>`) by the extension
 * points before they reach `register`.
 */
export interface AiToolRegistry {
  register(tool: RegisteredAiTool): void;
  getTools(): RegisteredAiTool[];
  getTool(name: string): RegisteredAiTool | undefined;
  hasTool(name: string): boolean;
}

export function createAiToolRegistry(): AiToolRegistry {
  const tools = new Map<string, RegisteredAiTool>();

  return {
    register(tool: RegisteredAiTool): void {
      if (tools.has(tool.name)) {
        throw new Error(
          `AI tool ${tool.name} already registered — likely a duplicate registration.`,
        );
      }
      tools.set(tool.name, tool);
    },

    getTools(): RegisteredAiTool[] {
      return [...tools.values()];
    },

    getTool(name: string): RegisteredAiTool | undefined {
      return tools.get(name);
    },

    hasTool(name: string): boolean {
      return tools.has(name);
    },
  };
}
