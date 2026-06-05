import { createExtensionPoint } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import type { RegisteredAiTool } from "./tool-registry";
import type { ProjectToolInput } from "./projection";

/**
 * Path 1 — hand-authored composite tools (decision 2b).
 *
 * Plugins register coarser/curated tools (e.g. `automation.propose`) here when
 * the model needs a different surface than raw CRUD. The tool name is qualified
 * with the registering plugin id before it reaches the registry.
 */
export interface AiToolExtensionPoint {
  registerTool<TInput, TOutput>(
    tool: RegisteredAiTool<TInput, TOutput>,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const aiToolExtensionPoint = createExtensionPoint<AiToolExtensionPoint>(
  "ai.toolExtensionPoint",
);

/**
 * Path 2 — opt-in projection of an existing oRPC procedure (decision 2a).
 *
 * The projected tool reads the procedure's access rules and input schema
 * verbatim; nothing is duplicated. `effect` is REQUIRED and never inferred.
 *
 * The owning plugin metadata lives on `input.sourcePluginMetadata` (it must be
 * the SOURCE procedure's plugin so qualified access-rule IDs match what
 * `autoAuthMiddleware` enforces), so `expose` takes no separate metadata arg.
 */
export interface AiToolProjectionExtensionPoint {
  expose<TInput, TOutput>(input: ProjectToolInput<TInput, TOutput>): void;
}

export const aiToolProjectionExtensionPoint =
  createExtensionPoint<AiToolProjectionExtensionPoint>(
    "ai.toolProjectionExtensionPoint",
  );
