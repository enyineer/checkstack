import type { PluginMetadata } from "@checkstack/common";
import { toJsonSchema } from "@checkstack/backend-api";
import type {
  RegisteredTrigger,
  TriggerDefinition,
} from "./action-types";

/**
 * Registry for automation triggers. Plugins register triggers here through
 * `automationTriggerExtensionPoint`; the dispatch engine reads from this
 * registry in `afterPluginsReady` to wire up hook subscriptions and custom
 * setups.
 */
export interface TriggerRegistry {
  register<TPayload, TConfig = void>(
    definition: TriggerDefinition<TPayload, TConfig>,
    pluginMetadata: PluginMetadata,
  ): void;

  /** Get every registered trigger. */
  getTriggers(): RegisteredTrigger[];
  /** Look up a trigger by its fully qualified id. */
  getTrigger(qualifiedId: string): RegisteredTrigger | undefined;
  /** Group triggers by their category for UI listings. */
  getTriggersByCategory(): Map<string, RegisteredTrigger[]>;
  hasTrigger(qualifiedId: string): boolean;
}

export function createTriggerRegistry(): TriggerRegistry {
  const triggers = new Map<string, RegisteredTrigger>();

  return {
    register<TPayload, TConfig = void>(
      definition: TriggerDefinition<TPayload, TConfig>,
      pluginMetadata: PluginMetadata,
    ): void {
      const qualifiedId = `${pluginMetadata.pluginId}.${definition.id}`;
      if (triggers.has(qualifiedId)) {
        throw new Error(
          `Trigger ${qualifiedId} already registered — likely a duplicate registration in ${pluginMetadata.pluginId}.`,
        );
      }

      // Defence in depth: a trigger must be reachable somehow.
      if (!definition.hook && !definition.setup) {
        throw new Error(
          `Trigger ${qualifiedId} has neither a hook nor a setup callback; it cannot fire.`,
        );
      }

      const payloadJsonSchema = toJsonSchema(definition.payloadSchema);
      const configJsonSchema = definition.configSchema
        ? toJsonSchema(definition.configSchema)
        : undefined;

      const registered: RegisteredTrigger<TPayload, TConfig> = {
        id: definition.id,
        displayName: definition.displayName,
        description: definition.description,
        category: definition.category ?? "Uncategorized",
        icon: definition.icon,
        payloadSchema: definition.payloadSchema,
        configSchema: definition.configSchema,
        contextKey: definition.contextKey,
        contextKeyLabel: definition.contextKeyLabel,
        hook: definition.hook,
        setup: definition.setup,
        evaluateConfig: definition.evaluateConfig,
        qualifiedId,
        ownerPluginId: pluginMetadata.pluginId,
        payloadJsonSchema,
        configJsonSchema,
      };

      triggers.set(qualifiedId, registered as RegisteredTrigger);
    },

    getTriggers(): RegisteredTrigger[] {
      return [...triggers.values()];
    },

    getTrigger(qualifiedId: string): RegisteredTrigger | undefined {
      return triggers.get(qualifiedId);
    },

    getTriggersByCategory(): Map<string, RegisteredTrigger[]> {
      const byCategory = new Map<string, RegisteredTrigger[]>();
      for (const trigger of triggers.values()) {
        const category = trigger.category ?? "Uncategorized";
        const existing = byCategory.get(category) ?? [];
        existing.push(trigger);
        byCategory.set(category, existing);
      }
      return byCategory;
    },

    hasTrigger(qualifiedId: string): boolean {
      return triggers.has(qualifiedId);
    },
  };
}
