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
import { setupSyncWorker } from "./sync/sync-worker";
import { secretResolverRef, secretAdminRef } from "@checkstack/secrets-backend";
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
      registerSpecSchemaDocumentation(params) {
        kindRegistry.registerSpecSchemaDocumentation(params);
      },
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        queueManager: coreServices.queueManager,
        secretResolver: secretResolverRef,
        secretAdmin: secretAdminRef,
      },
      init: async ({
        logger,
        database,
        rpc,
        queueManager,
        secretResolver,
        secretAdmin,
      }) => {
        logger.debug("🔄 Initializing GitOps Backend...");

        const db = database as SafeDatabase<typeof schema>;

        const router = createGitOpsRouter({
          database: db,
          queueManager,
          kindRegistry,
          secretAdmin,
          secretResolver,
        });
        rpc.registerRouter(router, gitopsContract);

        logger.debug("✅ GitOps Backend initialized.");
      },
      afterPluginsReady: async ({
        logger,
        database,
        queueManager,
        secretResolver,
      }) => {
        const registeredKinds = kindRegistry.getKinds();
        logger.debug(
          `🔄 GitOps: ${registeredKinds.length} entity kinds registered: ${registeredKinds.map((k) => k.kind).join(", ")}`,
        );

        const db = database as SafeDatabase<typeof schema>;

        // Resolve ${{ secrets.NAME }} via the central Secrets platform
        // (secretResolverRef) instead of reading the gitops secrets table
        // directly. The Secrets platform owns the table now.
        const secretStore = {
          resolve: (name: string): Promise<string> =>
            secretResolver.resolveSecret({ name }),
        };

        // Bootstrap sync worker
        await setupSyncWorker({
          db,
          logger,
          queueManager,
          kindRegistry,
          secretStore,
        });
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
