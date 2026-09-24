import {
  type NotificationStrategy,
  type RegisteredNotificationStrategy,
  type NotificationStrategyRegistry,
} from "@checkstack/backend-api";
import {
  access,
  type AccessRule,
  type PluginMetadata,
} from "@checkstack/common";

/**
 * Registry for notification strategies.
 *
 * Maintained by notification-backend. Strategies are contributed by other
 * plugins via `notificationStrategyExtensionPoint`, which calls `register`.
 */
export interface NotificationStrategyRegistryWithRules
  extends NotificationStrategyRegistry {
  /**
   * Access rules synthesized for the registered strategies, grouped by the
   * owning plugin. Emitted via `coreHooks.accessRulesRegistered` so the
   * auth-backend syncs them into the `access_rule` table.
   */
  getNewAccessRules: () => Array<{
    accessRule: AccessRule;
    ownerPluginId: string;
  }>;
}

/**
 * Create a new notification strategy registry instance.
 */
export function createNotificationStrategyRegistry(): NotificationStrategyRegistryWithRules {
  const strategies = new Map<
    string,
    RegisteredNotificationStrategy<unknown, unknown, unknown>
  >();
  const newAccessRules: Array<{
    accessRule: AccessRule;
    ownerPluginId: string;
  }> = [];

  return {
    register<TConfig, TUserConfig, TLayoutConfig>(
      strategy: NotificationStrategy<TConfig, TUserConfig, TLayoutConfig>,
      metadata: PluginMetadata
    ): void {
      const qualifiedId = `${metadata.pluginId}.${strategy.id}`;

      // Single source of truth: the rule emitted for the DB sync and the id
      // checked by `getStrategiesForUser` derive from the same AccessRule, so
      // the two can never drift apart. The emitted id is qualified with the
      // owner plugin id (`{ownerPluginId}.strategy.{id}.manage`) to match the
      // id shape of every other registered rule - that prefix is also what
      // the plugin-deregistered cleanup sweeps by.
      const strategyAccessRule = access(
        `strategy.${strategy.id}`,
        "manage",
        `Use ${strategy.displayName} notification channel`,
        { pluginId: metadata.pluginId }
      );
      const accessRuleId = `${metadata.pluginId}.${strategyAccessRule.id}`;

      // Cast to unknown for storage - registry stores heterogeneous strategies
      const registered: RegisteredNotificationStrategy<
        unknown,
        unknown,
        unknown
      > = {
        ...(strategy as NotificationStrategy<unknown, unknown, unknown>),
        qualifiedId,
        ownerPluginId: metadata.pluginId,
        accessRuleId,
      };

      strategies.set(qualifiedId, registered);

      // Track new access rule for later registration
      newAccessRules.push({
        accessRule: { ...strategyAccessRule, id: accessRuleId },
        ownerPluginId: metadata.pluginId,
      });
    },

    getStrategy(
      qualifiedId: string
    ): RegisteredNotificationStrategy<unknown, unknown, unknown> | undefined {
      return strategies.get(qualifiedId);
    },

    getStrategies(): RegisteredNotificationStrategy<
      unknown,
      unknown,
      unknown
    >[] {
      return [...strategies.values()];
    },

    getStrategiesForUser(
      userAccessRules: Set<string>
    ): RegisteredNotificationStrategy<unknown, unknown, unknown>[] {
      // Admins carry the `"*"` wildcard (enriched users collapse the admin
      // role to it) - honour it like every other access-rule check.
      return [...strategies.values()].filter(
        (s) =>
          userAccessRules.has("*") || userAccessRules.has(s.accessRuleId)
      );
    },

    getNewAccessRules() {
      return newAccessRules;
    },
  };
}
