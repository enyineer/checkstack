import {
  createBackendPlugin,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { coreServices } from "@checkstack/backend-api";
import {
  aiToolExtensionPoint,
  aiToolProjectionExtensionPoint,
  deferredProjectionExecute,
} from "@checkstack/ai-backend";
import { buildCatalogAiTools } from "./ai/register-ai-tools";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
  automationTriggerExtensionPoint,
  entityExtensionPoint,
  type EntityHandle,
} from "@checkstack/automation-backend";
import {
  CATALOG_GROUP_ENTITY_KIND,
  CATALOG_SYSTEM_ENTITY_KIND,
  CatalogGroupStateSchema,
  CatalogSystemStateSchema,
  catalogGroupChangeToPayload,
  catalogSystemChangeToPayload,
  createCatalogGroupEntityRead,
  createCatalogSystemEntityRead,
  deriveCatalogGroupTriggerEvents,
  deriveCatalogSystemTriggerEvents,
  type CatalogGroupState,
  type CatalogSystemState,
} from "./catalog-entity";
import {
  catalogAccessRules,
  catalogAccess,
  pluginMetadata,
  catalogContract,
  catalogRoutes,
  catalogSystemTarget,
  catalogGroupTarget,
} from "@checkstack/catalog-common";
import { createCatalogRouter } from "./router";
import { createCatalogCache } from "./cache";
import {
  NotificationApi,
  targetToRegistration,
} from "@checkstack/notification-common";
import { AuthApi } from "@checkstack/auth-common";
import { authHooks } from "@checkstack/auth-backend";
import { resolveRoute, type InferClient, extractErrorMessage} from "@checkstack/common";
import { registerSearchProvider } from "@checkstack/command-backend";
import { EntityService } from "./services/entity-service";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import { CHECKSTACK_API_VERSION, entityRefSchema, GitOpsApi } from "@checkstack/gitops-common";
import { z } from "zod";

import {
  catalogTriggers,
  createCatalogActions,
  systemRecordArtifactType,
} from "./automations";

// Database schema is still needed for types in creating the router
import * as schema from "./schema";

export let db: SafeDatabase<typeof schema> | undefined;

// Reactive catalog entity handles (§10.4). Defined in register() via the
// entity extension point; mutate from init()/afterPluginsReady onward.
let systemEntity: EntityHandle<CatalogSystemState> | undefined;
let groupEntity: EntityHandle<CatalogGroupState> | undefined;

// The catalog EntityService is created in init() (it needs the resolved
// database), but the PLUGIN-BACKED entity `read` accessors must be supplied
// at `defineEntity` time in register(). This holder bridges the two: the
// `read` closures resolve the service lazily, and init() sets it before any
// mutation runs (the registry only mutates from init() onward).
let catalogEntityServiceRef: EntityService | undefined;

/**
 * Resolve the catalog EntityService for the PLUGIN-BACKED entity `read`
 * accessors. Throws if invoked before init() has published the service —
 * which never happens in practice, since the registry only reads/mutates
 * from init() onward.
 */
function resolveCatalogEntityService(): EntityService {
  const svc = catalogEntityServiceRef;
  if (!svc) {
    throw new Error(
      "catalog entity read before init: service not yet resolved",
    );
  }
  return svc;
}

// Export hooks for other plugins to subscribe to
export { catalogHooks } from "./hooks";

// Re-export the reactive catalog entity kind ids so cross-plugin consumers
// (incident, dependency, slo) can subscribe via onEntityChanged (§10.4).
export {
  CATALOG_SYSTEM_ENTITY_KIND,
  CATALOG_GROUP_ENTITY_KIND,
  type CatalogSystemState,
  type CatalogGroupState,
} from "./catalog-entity";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(catalogAccessRules);

    // ─── Automation Platform: triggers + artifact type ─────────────────
    // Buffered behind the extension point until automation-backend's
    // register() runs. The action factory is wired in afterPluginsReady
    // below — that's where `emitHook` becomes available, which the
    // `update_metadata` action needs in order to fire `systemUpdated`.
    const automationTriggers = env.getExtensionPoint(
      automationTriggerExtensionPoint,
    );
    for (const trigger of catalogTriggers) {
      automationTriggers.registerTrigger(trigger, pluginMetadata);
    }
    env
      .getExtensionPoint(automationArtifactTypeExtensionPoint)
      .registerArtifactType(systemRecordArtifactType, pluginMetadata);

    // ─── Reactive catalog entities (§10.4) ─────────────────────────────
    // PLUGIN-BACKED (Model B): the `systems` / `groups` tables ARE the
    // current-state storage. `read` routes straight to the EntityService's
    // batched authoritative read — no framework `entity_state` row, so no
    // `indexes` (those only apply to store-backed kinds). The `read` closures
    // resolve the service set by init() (mutations only happen from init on).
    const entityPoint = env.getExtensionPoint(entityExtensionPoint);
    systemEntity = entityPoint.defineEntity<CatalogSystemState>({
      kind: CATALOG_SYSTEM_ENTITY_KIND,
      state: CatalogSystemStateSchema,
      read: (ids) =>
        createCatalogSystemEntityRead(resolveCatalogEntityService())(ids),
    });
    groupEntity = entityPoint.defineEntity<CatalogGroupState>({
      kind: CATALOG_GROUP_ENTITY_KIND,
      state: CatalogGroupStateSchema,
      read: (ids) =>
        createCatalogGroupEntityRead(resolveCatalogEntityService())(ids),
    });
    entityPoint.registerChangeDeriver({
      kind: CATALOG_SYSTEM_ENTITY_KIND,
      derive: deriveCatalogSystemTriggerEvents,
      toPayload: catalogSystemChangeToPayload,
    });
    entityPoint.registerChangeDeriver({
      kind: CATALOG_GROUP_ENTITY_KIND,
      derive: deriveCatalogGroupTriggerEvents,
      toPayload: catalogGroupChangeToPayload,
    });

    // ─── GitOps Entity Kind Registration ───────────────────────────────
    // Mutable DB reference — populated during init(), consumed by reconcile closures.
    // Safe because reconcile is only called during sync (afterPluginsReady), by which
    // point init() has already completed.
    let gitopsDb: SafeDatabase<typeof schema> | undefined;

    const kindRegistry = env.getExtensionPoint(entityKindExtensionPoint);

    // Register kind: System
    kindRegistry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: z.object({}),
      reconcile: async ({ entity, existingEntityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        const entityService = new EntityService(gitopsDb);
        const displayName = entity.metadata.title ?? entity.metadata.name;
        const description = entity.metadata.description;

        if (existingEntityId) {
          await entityService.updateSystem(existingEntityId, {
            name: displayName,
            description,
          });
          context.logger.info(
            `GitOps: updated System "${displayName}" (id: ${existingEntityId})`,
          );
          return { entityId: existingEntityId };
        }

        const system = await entityService.createSystem({
          name: displayName,
          description,
        });
        context.logger.info(
          `GitOps: created System "${displayName}" (id: ${system.id})`,
        );
        return { entityId: system.id };
      },
      delete: async ({ entityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        if (!entityId) return;
        const entityService = new EntityService(gitopsDb);
        await entityService.deleteSystem(entityId);
        context.logger.info(`GitOps: deleted System (id: ${entityId})`);
      },
    });

    // Register kind extension: System -> groups
    kindRegistry.registerKindExtension({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      namespace: "groups",
      specSchema: z.array(entityRefSchema).optional(),
      reconcile: async ({ entity, extensionSpec, entityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        if (!extensionSpec || extensionSpec.length === 0) return;

        const entityService = new EntityService(gitopsDb);
        const systemEntityId = entityId;

        const desiredGroupIds = new Set<string>();

        for (const entry of extensionSpec) {
          const groupId = await context.resolveEntityRef({
            kind: entry.kind,
            entityName: entry.name,
          });

          if (!groupId) {
            throw new Error(
              `Cannot resolve ${entry.kind} ref "${entry.name}" — ensure the entity exists`
            );
          }

          desiredGroupIds.add(groupId);

          await entityService.addSystemToGroup({
            groupId: groupId,
            systemId: systemEntityId,
          });

          context.logger.info(
            `GitOps: associated System "${entity.metadata.name}" with Group "${entry.name}" (${groupId})`
          );
        }

        // Remove stale associations not in the spec
        const currentAssociations = await entityService.getGroupsForSystem(systemEntityId);
        for (const existing of currentAssociations) {
          if (!desiredGroupIds.has(existing.groupId)) {
            await entityService.removeSystemFromGroup({
              groupId: existing.groupId,
              systemId: systemEntityId,
            });
            context.logger.info(
              `GitOps: removed stale association ${existing.groupId} from System "${entity.metadata.name}"`
            );
          }
        }
      },
    });

    // Register kind: Group
    kindRegistry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Group",
      specSchema: z.object({}),
      reconcile: async ({ entity, existingEntityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        const entityService = new EntityService(gitopsDb);
        const displayName = entity.metadata.title ?? entity.metadata.name;

        if (existingEntityId) {
          await entityService.updateGroup(existingEntityId, {
            name: displayName,
          });
          context.logger.info(
            `GitOps: updated Group "${displayName}" (id: ${existingEntityId})`,
          );
          return { entityId: existingEntityId };
        }

        const group = await entityService.createGroup({
          name: displayName,
        });
        context.logger.info(
          `GitOps: created Group "${displayName}" (id: ${group.id})`,
        );
        return { entityId: group.id };
      },
      delete: async ({ entityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        if (!entityId) return;
        const entityService = new EntityService(gitopsDb);
        await entityService.deleteGroup(entityId);
        context.logger.info(`GitOps: deleted Group (id: ${entityId})`);
      },
    });

    // Register kind: Environment (mirror "Group")
    kindRegistry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Environment",
      // Free-form custom fields. `z.record` keeps GitOps in step with the
      // free-form metadata decision (v1): fields surface in templating verbatim.
      specSchema: z.object({
        fields: z.record(z.string(), z.unknown()).optional(),
      }),
      reconcile: async ({ entity, existingEntityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        const entityService = new EntityService(gitopsDb);
        const displayName = entity.metadata.title ?? entity.metadata.name;
        const description = entity.metadata.description;
        const metadata = entity.spec.fields ?? {};

        if (existingEntityId) {
          await entityService.updateEnvironment(existingEntityId, {
            name: displayName,
            description,
            metadata,
          });
          context.logger.info(
            `GitOps: updated Environment "${displayName}" (id: ${existingEntityId})`,
          );
          return { entityId: existingEntityId };
        }

        const environment = await entityService.createEnvironment({
          name: displayName,
          description,
          metadata,
        });
        context.logger.info(
          `GitOps: created Environment "${displayName}" (id: ${environment.id})`,
        );
        return { entityId: environment.id };
      },
      delete: async ({ entityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        if (!entityId) return;
        const entityService = new EntityService(gitopsDb);
        await entityService.deleteEnvironment(entityId);
        context.logger.info(`GitOps: deleted Environment (id: ${entityId})`);
      },
    });

    // Register kind extension: System -> environments (mirror System -> groups)
    kindRegistry.registerKindExtension({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      namespace: "environments",
      specSchema: z.array(entityRefSchema).optional(),
      reconcile: async ({ entity, extensionSpec, entityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        if (!extensionSpec || extensionSpec.length === 0) return;

        const entityService = new EntityService(gitopsDb);
        const systemEntityId = entityId;

        const desiredEnvironmentIds = new Set<string>();

        for (const entry of extensionSpec) {
          const environmentId = await context.resolveEntityRef({
            kind: entry.kind,
            entityName: entry.name,
          });

          if (!environmentId) {
            throw new Error(
              `Cannot resolve ${entry.kind} ref "${entry.name}" — ensure the entity exists`,
            );
          }

          desiredEnvironmentIds.add(environmentId);

          await entityService.addSystemToEnvironment({
            environmentId,
            systemId: systemEntityId,
          });

          context.logger.info(
            `GitOps: associated System "${entity.metadata.name}" with Environment "${entry.name}" (${environmentId})`,
          );
        }

        // Remove stale associations not in the spec
        const currentAssociations =
          await entityService.getEnvironmentsForSystem(systemEntityId);
        for (const existing of currentAssociations) {
          if (!desiredEnvironmentIds.has(existing.environmentId)) {
            await entityService.removeSystemFromEnvironment({
              environmentId: existing.environmentId,
              systemId: systemEntityId,
            });
            context.logger.info(
              `GitOps: removed stale association ${existing.environmentId} from System "${entity.metadata.name}"`,
            );
          }
        }
      },
    });

    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        logger: coreServices.logger,
        cacheManager: coreServices.cacheManager,
      },
      // Phase 2: Register router only - no RPC calls to other plugins
      init: async ({ database, rpc, rpcClient, logger, cacheManager }) => {
        logger.debug("Initializing Catalog Backend...");

        // Populate the mutable DB reference for GitOps reconcile closures
        gitopsDb = database as SafeDatabase<typeof schema>;

        const typedDb = database as SafeDatabase<typeof schema>;

        // Publish the EntityService for the PLUGIN-BACKED catalog entity
        // `read` accessors (defined in register()). Mutations only run from
        // here onward, so the lazy `read` closures always find it resolved.
        catalogEntityServiceRef = new EntityService(typedDb);

        // Get notification client for group management and sending notifications
        const notificationClient = rpcClient.forPlugin(NotificationApi);
        const authClient = rpcClient.forPlugin(AuthApi);
        const gitOpsClient = rpcClient.forPlugin(GitOpsApi);

        const cache = createCatalogCache({ cacheManager, logger });

        // Register oRPC router with notification client and auth client
        const catalogRouter = createCatalogRouter({
          database: typedDb,
          notificationClient,
          authClient,
          gitOpsClient,
          pluginId: pluginMetadata.pluginId,
          cache,
          getSystemEntity: () => systemEntity,
          getGroupEntity: () => groupEntity,
        });
        rpc.registerRouter(catalogRouter, catalogContract);

        // Register this plugin's AI tools (system + group + membership) into
        // the AI registry via the extension point - owned here, not in
        // ai-backend. The tools go through the USER-SCOPED client passed at
        // call time, so handler-side authorization is enforced exactly as a
        // direct UI/RPC call.
        const aiToolExt = env.getExtensionPoint(aiToolExtensionPoint);
        for (const tool of buildCatalogAiTools()) {
          aiToolExt.registerTool(tool, pluginMetadata);
        }

        // Expose this plugin's OWN read-only AI projections of the existing
        // `getSystems` / `getGroups` queries via aiToolProjectionExtensionPoint
        // - owned here, not in ai-backend. The projected read tools are routed
        // by the transport (MCP / chat) AS the principal, so the procedures'
        // own contract access rules gate them; `deferredProjectionExecute` is
        // the fail-closed net if a transport ever forgot to route.
        const aiProjectionExt = env.getExtensionPoint(
          aiToolProjectionExtensionPoint,
        );
        aiProjectionExt.expose({
          procedure: catalogContract.getSystems,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "getSystems",
          name: "catalog.listSystems",
          description:
            "List all systems (services/resources) with their ids and names. Read-only. Use this to resolve a system name to its id.",
          effect: "read",
          execute: deferredProjectionExecute,
        });
        aiProjectionExt.expose({
          procedure: catalogContract.getGroups,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "getGroups",
          name: "catalog.listGroups",
          description:
            "List all system groups with ids and names. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
        });

        // Register catalog systems as searchable in the command palette
        registerSearchProvider({
          pluginMetadata,
          provider: {
            id: "systems",
            name: "Systems",
            priority: 100, // High priority - systems are primary search target
            search: async (query) => {
              const systems = await typedDb.select().from(schema.systems);
              const q = query.toLowerCase();

              return systems
                .filter(
                  (s) =>
                    !q ||
                    s.name.toLowerCase().includes(q) ||
                    s.description?.toLowerCase().includes(q),
                )
                .map((s) => ({
                  id: s.id,
                  type: "entity" as const,
                  title: s.name,
                  subtitle: s.description ?? undefined,
                  category: "Systems",
                  iconName: "Activity",
                  route: resolveRoute(catalogRoutes.routes.systemDetail, {
                    systemId: s.id,
                  }),
                }));
            },
          },
          commands: [
            {
              id: "create",
              title: "Create System",
              subtitle: "Add a new system to the catalog",
              iconName: "Activity",
              route:
                resolveRoute(catalogRoutes.routes.config) + "?action=create",
              requiredAccessRules: [catalogAccess.system.manage],
            },
            {
              id: "manage",
              title: "Manage Systems",
              subtitle: "Manage systems in the catalog",
              iconName: "Activity",
              shortcuts: ["meta+shift+s", "ctrl+shift+s"],
              route: resolveRoute(catalogRoutes.routes.config),
              requiredAccessRules: [catalogAccess.system.manage],
            },
          ],
        });

        logger.debug("✅ Catalog Backend initialized.");
      },
      // Phase 3: Safe to make RPC calls after all plugins are ready
      afterPluginsReady: async ({
        database,
        rpcClient,
        logger,
        onHook,
        cacheManager,
      }) => {
        const typedDb = database as SafeDatabase<typeof schema>;
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        // Catalog owns the platform's "system" and "group" notification
        // target types. Register both target types, then push the
        // current set of resources + parent edges to notification-
        // backend in one shot. Per-resource notification group
        // provisioning happens server-side from this signal.
        await bootstrapNotificationTargets(typedDb, notificationClient, logger);

        // Register automation actions. The `update_metadata` action mirrors
        // its edit into the `catalog-system` entity, whose deriver fires the
        // `catalog.updated` trigger event downstream (§10.4).
        const automationActions = env.getExtensionPoint(
          automationActionExtensionPoint,
        );
        const entityService = new EntityService(typedDb);
        const cache = createCatalogCache({ cacheManager, logger });
        for (const action of createCatalogActions({
          entityService,
          cache,
          getSystemEntity: () => systemEntity,
        })) {
          automationActions.registerAction(action, pluginMetadata);
        }

        // Subscribe to user deletion to clean up user contacts
        onHook(
          authHooks.userDeleted,
          async ({ userId }) => {
            logger.debug(`Cleaning up contacts for deleted user: ${userId}`);
            const userCleanupService = new EntityService(typedDb);
            await userCleanupService.deleteContactsByUserId(userId);
            logger.debug(`Cleaned up contacts for user: ${userId}`);
          },
          { mode: "work-queue", workerGroup: "user-cleanup" },
        );
      },
    });
  },
});

/**
 * Register the catalog target types and seed every existing system /
 * group as a known resource. Runs every startup (idempotent on the
 * notification-backend side via primary-key upsert) so resources stay
 * in sync even if catalog and notification-backend are restarted in
 * different orders.
 */
async function bootstrapNotificationTargets(
  database: SafeDatabase<typeof schema>,
  notificationClient: InferClient<typeof NotificationApi>,
  logger: { debug: (msg: string) => void },
) {
  try {
    await Promise.all([
      notificationClient.registerNotificationTarget(
        targetToRegistration(catalogSystemTarget),
      ),
      notificationClient.registerNotificationTarget(
        targetToRegistration(catalogGroupTarget),
      ),
    ]);

    const systems = await database.select().from(schema.systems);
    const groups = await database.select().from(schema.groups);

    if (systems.length > 0) {
      await notificationClient.upsertNotificationResources({
        targetTypeId: catalogSystemTarget.targetTypeId,
        resources: systems.map((s) => ({
          resourceKey: s.id,
          displayLabel: s.name,
        })),
      });
    }

    if (groups.length > 0) {
      await notificationClient.upsertNotificationResources({
        targetTypeId: catalogGroupTarget.targetTypeId,
        resources: groups.map((g) => ({
          resourceKey: g.id,
          displayLabel: g.name,
        })),
      });
    }

    // Seed parent edges from the systems_groups join table so the
    // dispatcher can walk inheritance without re-querying catalog at
    // notification time.
    const memberships = await database.select().from(schema.systemsGroups);
    const parentsBySystem = new Map<string, string[]>();
    for (const m of memberships) {
      const arr = parentsBySystem.get(m.systemId) ?? [];
      arr.push(m.groupId);
      parentsBySystem.set(m.systemId, arr);
    }
    for (const [systemId, parentGroupIds] of parentsBySystem) {
      await notificationClient.setNotificationResourceParents({
        childTargetTypeId: catalogSystemTarget.targetTypeId,
        childResourceKey: systemId,
        parents: parentGroupIds.map((groupId) => ({
          parentTargetTypeId: catalogGroupTarget.targetTypeId,
          parentResourceKey: groupId,
        })),
      });
    }

    logger.debug(
      `Bootstrapped notification targets: ${systems.length} systems, ${groups.length} groups, ${memberships.length} parent edges`,
    );
  } catch (error) {
    logger.debug(
      `Failed to bootstrap notification targets: ${
        extractErrorMessage(error, "Unknown error")
      }`,
    );
  }
}
