import type { PluginMetadata } from "@checkstack/common";
import { toJsonSchema } from "@checkstack/backend-api";
import type {
  ActionDefinition,
  RegisteredAction,
} from "./action-types";

/**
 * Registry for automation actions. Plugins register actions through
 * `automationActionExtensionPoint`. The dispatch engine resolves actions
 * by their fully qualified id when running provider-action steps.
 */
export interface ActionRegistry {
  register<TConfig, TArtifact = unknown>(
    definition: ActionDefinition<TConfig, TArtifact>,
    pluginMetadata: PluginMetadata,
  ): void;

  getActions(): RegisteredAction[];
  getAction(qualifiedId: string): RegisteredAction | undefined;
  getActionsByCategory(): Map<string, RegisteredAction[]>;
  hasAction(qualifiedId: string): boolean;
}

export function createActionRegistry(): ActionRegistry {
  const actions = new Map<string, RegisteredAction>();

  return {
    register<TConfig, TArtifact = unknown>(
      definition: ActionDefinition<TConfig, TArtifact>,
      pluginMetadata: PluginMetadata,
    ): void {
      const qualifiedId = `${pluginMetadata.pluginId}.${definition.id}`;
      if (actions.has(qualifiedId)) {
        throw new Error(
          `Action ${qualifiedId} already registered — likely a duplicate registration in ${pluginMetadata.pluginId}.`,
        );
      }

      const configJsonSchema = toJsonSchema(definition.config.schema);

      const registered: RegisteredAction<TConfig, TArtifact> = {
        ...definition,
        qualifiedId,
        ownerPluginId: pluginMetadata.pluginId,
        configJsonSchema,
        // Qualify the produced artifact type id with the owning plugin,
        // exactly as the artifact-type registry qualifies its own ids, so
        // the two always agree (a hand-written full id would drift). The
        // local `consumes` ids stay as declared and are qualified against
        // this same plugin when resolved at run time.
        produces: definition.produces
          ? `${pluginMetadata.pluginId}.${definition.produces}`
          : undefined,
      };

      actions.set(qualifiedId, registered as RegisteredAction);
    },

    getActions(): RegisteredAction[] {
      return [...actions.values()];
    },

    getAction(qualifiedId: string): RegisteredAction | undefined {
      return actions.get(qualifiedId);
    },

    getActionsByCategory(): Map<string, RegisteredAction[]> {
      const byCategory = new Map<string, RegisteredAction[]>();
      for (const action of actions.values()) {
        const category = action.category ?? "Uncategorized";
        const existing = byCategory.get(category) ?? [];
        existing.push(action);
        byCategory.set(category, existing);
      }
      return byCategory;
    },

    hasAction(qualifiedId: string): boolean {
      return actions.has(qualifiedId);
    },
  };
}
