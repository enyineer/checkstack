import {
  createBackendPlugin,
  createExtensionPoint,
  coreServices,
} from "@checkstack/backend-api";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  pluginMetadata,
  gitopsAccessRules,
  gitopsContract,
} from "@checkstack/gitops-common";
import type {
  EntityKindDefinition,
  EntityKindExtensionDefinition,
  EntityKindRegistry,
} from "@checkstack/gitops-common";
import { createEntityKindRegistry } from "./kind-registry";
import { createGitOpsRouter } from "./router";
import * as schema from "./schema";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Extension Points
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Extension point for the Entity Kind Registry.
 * Plugins use this during their `register()` phase to register entity kinds
 * and spec extensions for the GitOps system.
 *
 * @example
 * ```typescript
 * import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
 *
 * // In your plugin's register() function:
 * const registry = env.getExtensionPoint(entityKindExtensionPoint);
 * registry.registerKind({
 *   apiVersion: "checkstack.io/v1alpha1",
 *   kind: "System",
 *   specSchema: z.object({ description: z.string().optional() }),
 *   reconcile: async ({ entity }) => { ... },
 * });
 * ```
 */
export const entityKindExtensionPoint =
  createExtensionPoint<EntityKindRegistry>("gitops.entity-kind-registry");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin Definition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Create the kind registry
    const kindRegistry = createEntityKindRegistry();

    // Register access rules
    env.registerAccessRules(gitopsAccessRules);

    // Register the Entity Kind Extension Point
    // Other plugins call this to register their entity kinds and extensions
    env.registerExtensionPoint(entityKindExtensionPoint, {
      registerKind<TSpec>(definition: EntityKindDefinition<TSpec>) {
        kindRegistry.registerKind(definition);
      },
      registerKindExtension<TExtensionSpec>(
        definition: EntityKindExtensionDefinition<TExtensionSpec>,
      ) {
        kindRegistry.registerKindExtension(definition);
      },
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
      },
      init: async ({ logger, database, rpc }) => {
        logger.debug("🔄 Initializing GitOps Backend...");

        const router = createGitOpsRouter({
          database: database as SafeDatabase<typeof schema>,
        });
        rpc.registerRouter(router, gitopsContract);

        logger.debug("✅ GitOps Backend initialized.");
      },
      afterPluginsReady: async ({ logger }) => {
        const registeredKinds = kindRegistry.getKinds();
        logger.debug(
          `🔄 GitOps: ${registeredKinds.length} entity kinds registered: ${registeredKinds.map((k) => k.kind).join(", ")}`,
        );
        // TODO(phase-2): Bootstrap sync workers for each provider
      },
    });
  },
});

// Re-export types for consumer plugins
export type {
  EntityKindDefinition,
  EntityKindExtensionDefinition,
  EntityKindRegistry,
  ReconcileContext,
} from "@checkstack/gitops-common";
