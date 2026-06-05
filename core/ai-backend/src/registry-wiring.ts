import type { PluginMetadata } from "@checkstack/common";
import type {
  AiToolExtensionPoint,
  AiToolProjectionExtensionPoint,
} from "./extension-points";
import { buildProjectedTool } from "./projection";
import type { AiToolRegistry } from "./tool-registry";

/**
 * Build the two extension-point implementations that feed a tool {@link
 * AiToolRegistry}. Factored out of the plugin `register()` so the exact
 * production wiring (name qualification for hand-authored tools, `expose`
 * building a projected tool from a contract procedure) is unit-testable
 * end-to-end without standing up a full plugin environment.
 *
 * Both paths are the ONLY way a tool reaches the registry:
 * - `registerTool` qualifies a hand-authored composite tool's name with the
 *   registering plugin id (unless already qualified).
 * - `expose` builds a projected tool from an oRPC contract procedure via
 *   {@link buildProjectedTool} and registers it.
 */
/**
 * Routing metadata for a projected read tool, accumulated as plugins `expose`
 * their own read procedures. The MCP transport and the chat read-loop re-enter
 * the live router using `{ pluginId, procedureKey }`, so ai-backend collects this
 * AFTER all plugins have registered (in `afterPluginsReady`) - it does not need
 * to know which plugins exist or import their `*-common`.
 */
export interface ExposedProjectionRoute {
  toolName: string;
  pluginId: string;
  procedureKey: string;
}

export function createRegistryExtensionPoints({
  registry,
}: {
  registry: AiToolRegistry;
}): {
  toolExtensionPoint: AiToolExtensionPoint;
  projectionExtensionPoint: AiToolProjectionExtensionPoint;
  /** Routing for every projection exposed via the point (populated lazily). */
  exposedProjections: ExposedProjectionRoute[];
} {
  const toolExtensionPoint: AiToolExtensionPoint = {
    registerTool: (tool, metadata: PluginMetadata) => {
      const qualifiedName = tool.name.includes(".")
        ? tool.name
        : `${metadata.pluginId}.${tool.name}`;
      registry.register({ ...tool, name: qualifiedName });
    },
  };

  const exposedProjections: ExposedProjectionRoute[] = [];
  const projectionExtensionPoint: AiToolProjectionExtensionPoint = {
    expose: (input) => {
      const tool = buildProjectedTool(input);
      registry.register(tool);
      exposedProjections.push({
        toolName: tool.name,
        pluginId: input.sourcePluginMetadata.pluginId,
        procedureKey: input.procedureKey,
      });
    },
  };

  return { toolExtensionPoint, projectionExtensionPoint, exposedProjections };
}
