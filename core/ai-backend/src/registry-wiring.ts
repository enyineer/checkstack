import type { PluginMetadata } from "@checkstack/common";
import type {
  AiToolExtensionPoint,
  AiToolProjectionExtensionPoint,
  SystemSignalsContributor,
  SystemSignalsExtensionPoint,
} from "./extension-points";
import { buildProjectedTool } from "./projection";
import { toProviderToolName } from "./tool-name";
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
  /**
   * Optional model-facing result projection (see `ProjectToolInput.projectResult`).
   * Applied by the chat read-loop AFTER the routed call returns the procedure's
   * full output, before the result enters the model context. Typed as
   * `(output: unknown)` here because the route array is non-generic; the wrapped
   * function narrows to the procedure's output type at the call site.
   */
  projectResult?: (output: unknown) => unknown;
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
      // Wrap the (typed) projectResult into an (output: unknown) signature for
      // the non-generic route. The routed call returns this projection's own
      // procedure output, so narrowing it to that output type is sound.
      const projectResult = input.projectResult;
      exposedProjections.push({
        // Match the registry's canonical (provider-safe) key so the chat
        // read-loop and MCP transport resolve this route by the same name the
        // model is given and echoes back.
        toolName: toProviderToolName(tool.name),
        pluginId: input.sourcePluginMetadata.pluginId,
        procedureKey: input.procedureKey,
        projectResult: projectResult
          ? (output: unknown) => projectResult(output as never)
          : undefined,
      });
    },
  };

  return { toolExtensionPoint, projectionExtensionPoint, exposedProjections };
}

/**
 * Build the {@link SystemSignalsExtensionPoint} implementation that accumulates
 * every registered contributor into a shared array, mirroring how {@link
 * createRegistryExtensionPoints} accumulates `exposedProjections`. The returned
 * `contributors` array is the SAME reference the `system.issues` tool reads at
 * execute time, so contributors registered from any plugin's `init` are visible
 * to the tool by the time it runs.
 */
export function createSystemSignalsExtensionPoint(): {
  systemSignalsExtensionPoint: SystemSignalsExtensionPoint;
  /** Every contributor registered via the point (populated lazily at init). */
  contributors: SystemSignalsContributor[];
} {
  const contributors: SystemSignalsContributor[] = [];
  const systemSignalsExtensionPoint: SystemSignalsExtensionPoint = {
    contribute: (contributor) => {
      contributors.push(contributor);
    },
  };
  return { systemSignalsExtensionPoint, contributors };
}
