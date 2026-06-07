import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import type { AiTool } from "@checkstack/ai-common";
import { toProviderToolName } from "./tool-name";

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
 * points before they reach `register`. `register` then maps the name to its
 * provider-safe form (see {@link toProviderToolName}) and uses that as the
 * canonical key, so every consumer (serializer, chat SDK tools, MCP
 * `tools/list`, and the tool-call resolution path) sees and resolves the same
 * provider-safe name. A name with an illegal character (beyond the "."
 * separator) is rejected here rather than rewritten.
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
      // Map to the provider-safe name (e.g. `incident.list` -> `incident_list`)
      // and key the registry on it, so the name sent to the model and the name
      // it echoes back both match this entry. Throws on an illegal name.
      const name = toProviderToolName(tool.name);
      if (tools.has(name)) {
        throw new Error(
          `AI tool ${name} already registered — likely a duplicate registration.`,
        );
      }
      tools.set(name, name === tool.name ? tool : { ...tool, name });
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
