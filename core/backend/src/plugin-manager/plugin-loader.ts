import { migrate } from "drizzle-orm/node-postgres/migrator";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import path from "node:path";
import fs from "node:fs";
import type { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  coreServices,
  BackendPlugin,
  AfterPluginsReadyContext,
  DatabaseDeps,
  ServiceRef,
  Deps,
  ResolvedDeps,
  coreHooks,
  HookSubscribeOptions,
  RpcContext,
} from "@checkstack/backend-api";
import type { AccessRule } from "@checkstack/common";
import { getPluginSchemaName } from "@checkstack/drizzle-helper";
import { rootLogger } from "../logger";
import type { ServiceRegistry } from "../services/service-registry";
import { plugins } from "../schema";
import { stripPublicSchemaFromMigrations } from "../utils/strip-public-schema";
import {
  discoverLocalPlugins,
  syncPluginsToDatabase,
} from "../utils/plugin-discovery";
import type { InitCallback, PendingInit } from "./types";
import { sortPlugins } from "./dependency-sorter";
import { createApiRouteHandler, registerApiRoute } from "./api-router";
import type { ExtensionPointManager } from "./extension-points";
import { Router } from "@orpc/server";
import { AnyContractRouter } from "@orpc/contract";
import type { PluginMetadata } from "@checkstack/common";
import { createScopedDb } from "../utils/scoped-db";

export interface PluginLoaderDeps {
  registry: ServiceRegistry;
  pluginRpcRouters: Map<string, unknown>;
  pluginHttpHandlers: Map<string, (req: Request) => Promise<Response>>;
  extensionPointManager: ExtensionPointManager;
  registeredAccessRules: (AccessRule & { pluginId: string })[];
  getAllAccessRules: () => AccessRule[];
  db: SafeDatabase<Record<string, unknown>>;
  /**
   * Map of pluginId -> PluginMetadata for request-time context injection.
   */
  pluginMetadataRegistry: Map<string, PluginMetadata>;
  /**
   * Map of pluginId -> cleanup handlers (stored in registration order, executed LIFO)
   */
  cleanupHandlers: Map<string, Array<() => Promise<void>>>;
  /**
   * Map of pluginId -> contract for OpenAPI generation.
   */
  pluginContractRegistry: Map<string, AnyContractRouter>;
}

/**
 * Registers a single plugin - called during Phase 1.
 */
export function registerPlugin({
  backendPlugin,
  pluginPath,
  pendingInits,
  providedBy,
  deps,
}: {
  backendPlugin: BackendPlugin;
  pluginPath: string;
  pendingInits: PendingInit[];
  providedBy: Map<string, string>;
  deps: PluginLoaderDeps;
}) {
  if (!backendPlugin || typeof backendPlugin.register !== "function") {
    rootLogger.warn(
      `Plugin ${
        backendPlugin?.metadata?.pluginId || "unknown"
      } is not using new API. Skipping.`,
    );
    return;
  }

  const pluginId = backendPlugin.metadata.pluginId;

  // Store metadata for request-time context injection
  deps.pluginMetadataRegistry.set(pluginId, backendPlugin.metadata);

  // Execute Register
  backendPlugin.register({
    registerInit: <
      D extends Deps,
      S extends Record<string, unknown> | undefined = undefined,
    >(args: {
      deps: D;
      schema?: S;
      init: (deps: ResolvedDeps<D> & DatabaseDeps<S>) => Promise<void>;
      afterPluginsReady?: (
        deps: ResolvedDeps<D> & DatabaseDeps<S> & AfterPluginsReadyContext,
      ) => Promise<void>;
    }) => {
      pendingInits.push({
        metadata: backendPlugin.metadata,
        pluginPath: pluginPath,
        deps: args.deps,
        init: args.init as InitCallback,
        afterPluginsReady: args.afterPluginsReady as InitCallback | undefined,
        schema: args.schema,
      });
    },
    registerService: (ref: ServiceRef<unknown>, impl: unknown) => {
      deps.registry.register(ref, impl);
      providedBy.set(ref.id, pluginId);
      rootLogger.debug(`   -> Registered service '${ref.id}'`);
    },
    registerExtensionPoint: (ref, impl) => {
      deps.extensionPointManager.registerExtensionPoint(ref, impl);
    },
    getExtensionPoint: (ref) => {
      return deps.extensionPointManager.getExtensionPoint(ref);
    },
    registerAccessRules: (accessRules: AccessRule[]) => {
      // Store access rules with pluginId prefix to namespace them
      const prefixed = accessRules.map((rule) => ({
        ...rule,
        pluginId: pluginId,
        id: `${pluginId}.${rule.id}`,
      }));
      deps.registeredAccessRules.push(...prefixed);
      rootLogger.debug(
        `   -> Registered ${prefixed.length} access rules for ${pluginId}`,
      );
    },
    registerRouter: (
      router: Router<AnyContractRouter, RpcContext>,
      contract: AnyContractRouter,
    ) => {
      deps.pluginRpcRouters.set(pluginId, router);
      deps.pluginContractRegistry.set(pluginId, contract);
      rootLogger.debug(`   -> Registered router and contract for ${pluginId}`);
    },
    registerCleanup: (cleanup: () => Promise<void>) => {
      const existing = deps.cleanupHandlers.get(pluginId) || [];
      existing.push(cleanup);
      deps.cleanupHandlers.set(pluginId, existing);
      rootLogger.debug(`   -> Registered cleanup handler for ${pluginId}`);
    },
    pluginManager: {
      getAllAccessRules: () => deps.getAllAccessRules(),
    },
  });
}

/**
 * Loads all plugins - main orchestration function.
 */
export async function loadPlugins({
  rootRouter,
  manualPlugins = [],
  skipDiscovery = false,
  deps,
}: {
  rootRouter: Hono;
  manualPlugins?: BackendPlugin[];
  /** When true, skip filesystem plugin discovery (for testing) */
  skipDiscovery?: boolean;
  deps: PluginLoaderDeps;
}) {
  if (skipDiscovery) {
    rootLogger.debug("⏭️  Plugin discovery skipped (test mode)");
  } else {
    rootLogger.info("🔍 Discovering plugins...");
  }

  // 1. Discover local BACKEND plugins from monorepo using package.json metadata
  let allPlugins: Array<{ name: string; path: string }> = [];

  if (!skipDiscovery) {
    const workspaceRoot = path.join(__dirname, "..", "..", "..", "..");
    const localPlugins = discoverLocalPlugins({
      workspaceRoot,
      type: "backend",
    });

    rootLogger.debug(
      `   -> Found ${localPlugins.length} local backend plugin(s) in workspace`,
    );
    rootLogger.debug("   -> Discovered plugins:");
    for (const p of localPlugins) {
      rootLogger.debug(`      • ${p.packageName}`);
    }

    // 2. Sync local plugins to database
    await syncPluginsToDatabase({ localPlugins, db: deps.db });

    // 3. Load all enabled BACKEND plugins from database
    allPlugins = await deps.db
      .select()
      .from(plugins)
      .where(and(eq(plugins.enabled, true), eq(plugins.type, "backend")));

    rootLogger.debug(
      `   -> ${allPlugins.length} enabled backend plugins in database:`,
    );
    for (const p of allPlugins) {
      rootLogger.debug(`      • ${p.name}`);
    }
  }

  if (allPlugins.length === 0 && manualPlugins.length === 0) {
    rootLogger.info("ℹ️  No enabled plugins found.");
    return;
  }

  // Phase 1: Load Modules & Register Services
  const pendingInits: PendingInit[] = [];
  const providedBy = new Map<string, string>();

  for (const plugin of allPlugins) {
    rootLogger.debug(`🔌 Loading module ${plugin.name}...`);

    try {
      let pluginModule;
      try {
        pluginModule = await import(plugin.name);
      } catch {
        rootLogger.debug(
          `   -> Package name import failed, trying path: ${plugin.path}`,
        );
        pluginModule = await import(plugin.path);
      }

      const backendPlugin: BackendPlugin = pluginModule.default;
      registerPlugin({
        backendPlugin,
        pluginPath: plugin.path,
        pendingInits,
        providedBy,
        deps,
      });
    } catch (error) {
      rootLogger.error(`❌ Failed to load module for ${plugin.name}:`, error);
      rootLogger.error(`   Expected path: ${plugin.path}`);
      throw new Error(`Failed to load plugin ${plugin.name}`, { cause: error });
    }
  }

  // Phase 1.5: Register manual plugins
  for (const backendPlugin of manualPlugins) {
    registerPlugin({
      backendPlugin,
      pluginPath: "",
      pendingInits,
      providedBy,
      deps,
    });
  }

  // Phase 2: Initialize Plugins (Topological Sort)
  const logger = await deps.registry.get(coreServices.logger, {
    pluginId: "core",
  });
  const sortedIds = sortPlugins({ pendingInits, providedBy, logger });
  rootLogger.debug(`✅ Initialization Order: ${sortedIds.join(" -> ")}`);

  // Register /api/* route BEFORE plugin initialization
  const apiHandler = createApiRouteHandler({
    registry: deps.registry,
    pluginRpcRouters: deps.pluginRpcRouters,
    pluginHttpHandlers: deps.pluginHttpHandlers,
    pluginMetadataRegistry: deps.pluginMetadataRegistry,
  });
  registerApiRoute(rootRouter, apiHandler);

  for (const id of sortedIds) {
    const p = pendingInits.find((x) => x.metadata.pluginId === id)!;
    rootLogger.info(`🚀 Initializing ${p.metadata.pluginId}...`);

    try {
      /**
       * =======================================================================
       * PLUGIN MIGRATIONS WITH SCHEMA ISOLATION
       * =======================================================================
       *
       * Each plugin's database objects live in a dedicated PostgreSQL schema
       * (e.g., "plugin_maintenance", "plugin_healthcheck"). This isolation is
       * achieved through PostgreSQL's `search_path` mechanism.
       *
       * ## Why SET search_path is Required for Migrations
       *
       * Drizzle's `migrate()` function reads SQL files and executes them directly.
       * These SQL files contain unqualified table names like:
       *
       *   ALTER TABLE "maintenances" ADD COLUMN "foo" boolean;
       *
       * Without setting search_path, PostgreSQL defaults to the `public` schema,
       * causing "relation does not exist" errors since the tables are actually in
       * the plugin's schema (e.g., `plugin_maintenance.maintenances`).
       *
       * ## Session-Level vs Transaction-Level search_path
       *
       * We use **session-level** `SET search_path` (not `SET LOCAL`) here because:
       * - `migrate()` runs multiple statements and may manage its own transactions
       * - `SET LOCAL` only persists within a single transaction
       * - Session-level SET persists until explicitly changed or session ends
       *
       * ## Why This Doesn't Affect Runtime Queries
       *
       * After migrations complete, plugins receive their database via
       * `createScopedDb()` which wraps every query in a transaction with
       * `SET LOCAL search_path`. This ensures runtime queries always use the
       * correct schema, regardless of the session-level search_path.
       *
       * ## Potential Hazards
       *
       * 1. **Error During Migration**: If a migration fails, the search_path may
       *    remain set to that plugin's schema. The next plugin's migration would
       *    fail visibly (wrong schema), which is better than silent data corruption.
       *
       * 2. **Parallel Migration Execution**: This code assumes sequential plugin
       *    initialization (which is enforced by the topologically-sorted loop).
       *    If migrations ever run in parallel, search_path conflicts would occur.
       *
       * 3. **Connection Pool Pollution**: `SET` without `LOCAL` affects the entire
       *    session. However, we reset to `public` after each plugin's migrations,
       *    and runtime queries use `SET LOCAL` anyway, so this is safe.
       *
       * @see createScopedDb in ../utils/scoped-db.ts for runtime query isolation
       * @see getPluginSchemaName in @checkstack/drizzle-helper for schema naming
       * =======================================================================
       */

      // Run Migrations
      const migrationsFolder = path.join(p.pluginPath, "drizzle");
      const migrationsSchema = getPluginSchemaName(p.metadata.pluginId);
      if (fs.existsSync(migrationsFolder)) {
        try {
          // Strip "public". schema references from migration SQL at runtime
          stripPublicSchemaFromMigrations(migrationsFolder);
          rootLogger.debug(
            `   -> Running migrations for ${p.metadata.pluginId} from ${migrationsFolder}`,
          );

          // Set search_path to plugin schema before running migrations.
          // Uses session-level SET (not SET LOCAL) because migrate() may run
          // multiple statements across transaction boundaries.
          await deps.db.execute(
            sql.raw(`SET search_path = "${migrationsSchema}", public`),
          );
          // Drizzle migrate() requires NodePgDatabase, cast from SafeDatabase
          await migrate(deps.db as NodePgDatabase<Record<string, unknown>>, {
            migrationsFolder,
            migrationsSchema,
          });

          // Reset search_path to public after migrations complete.
          // This prevents search_path leaking into subsequent plugin migrations.
          await deps.db.execute(sql.raw(`SET search_path = public`));
        } catch (error) {
          rootLogger.error(
            `❌ Failed migration of plugin ${p.metadata.pluginId}:`,
            error,
          );
          throw new Error(`Failed to migrate plugin ${p.metadata.pluginId}`, {
            cause: error,
          });
        }
      } else {
        rootLogger.debug(
          `   -> No migrations found for ${p.metadata.pluginId} (skipping)`,
        );
      }

      // Resolve Dependencies
      const resolvedDeps: Record<string, unknown> = {};
      for (const [key, ref] of Object.entries(p.deps)) {
        resolvedDeps[key] = await deps.registry.get(
          ref as ServiceRef<unknown>,
          p.metadata,
        );
      }

      // Inject Schema-aware Database if schema is provided
      if (p.schema) {
        const assignedSchema = getPluginSchemaName(p.metadata.pluginId);
        resolvedDeps["database"] = createScopedDb(deps.db, assignedSchema);
      }

      try {
        await p.init(resolvedDeps);
        rootLogger.debug(`   -> Initialized ${p.metadata.pluginId}`);
      } catch (error) {
        rootLogger.error(
          `❌ Failed to initialize ${p.metadata.pluginId}:`,
          error,
        );
        throw new Error(`Failed to initialize plugin ${p.metadata.pluginId}`, {
          cause: error,
        });
      }
    } catch (error) {
      rootLogger.error(
        `❌ Critical error loading plugin ${p.metadata.pluginId}:`,
        error,
      );
      throw new Error(`Critical error loading plugin ${p.metadata.pluginId}`, {
        cause: error,
      });
    }
  }

  // Emit pluginInitialized hooks for all plugins after Phase 2 completes
  // (EventBus is now available)
  const eventBus = await deps.registry.get(coreServices.eventBus, {
    pluginId: "core",
  });
  for (const p of pendingInits) {
    try {
      await eventBus.emit(coreHooks.pluginInitialized, {
        pluginId: p.metadata.pluginId,
      });
    } catch (error) {
      rootLogger.error(
        `Failed to emit pluginInitialized hook for ${p.metadata.pluginId}:`,
        error,
      );
    }
  }

  // Phase 2.5: Validate that all access rules used in contracts are registered
  // This catches bugs where access rules are used in procedures but not added to
  // the plugin's accessRules registration array.
  rootLogger.debug("🔍 Validating access rules in contracts...");
  const registeredRuleIds = new Set(
    deps.registeredAccessRules.map((r) => r.id),
  );
  const validationErrors: string[] = [];

  for (const [pluginId, contract] of deps.pluginContractRegistry) {
    validateContractAccessRules({
      pluginId,
      contract,
      registeredRuleIds,
      validationErrors,
    });
  }

  if (validationErrors.length > 0) {
    rootLogger.error("❌ Unregistered access rules found in contracts:");
    for (const error of validationErrors) {
      rootLogger.error(`   • ${error}`);
    }
    throw new Error(
      `Unregistered access rules in contracts:\n${validationErrors.join("\n")}`,
    );
  }
  rootLogger.debug("✅ All access rules in contracts are registered");

  // Phase 3: Run afterPluginsReady callbacks
  rootLogger.debug("🔄 Running afterPluginsReady callbacks...");

  // Emit access rule registration hooks at start of Phase 3
  // (EventBus already retrieved above, all plugins can receive notifications)
  const accessRulesByPlugin = new Map<string, AccessRule[]>();
  for (const { pluginId, ...rule } of deps.registeredAccessRules) {
    if (!accessRulesByPlugin.has(pluginId)) {
      accessRulesByPlugin.set(pluginId, []);
    }
    accessRulesByPlugin.get(pluginId)!.push(rule);
  }
  for (const [pluginId, accessRules] of accessRulesByPlugin) {
    try {
      await eventBus.emit(coreHooks.accessRulesRegistered, {
        pluginId,
        accessRules,
      });
    } catch (error) {
      rootLogger.error(
        `Failed to emit accessRulesRegistered hook for ${pluginId}:`,
        error,
      );
    }
  }
  for (const p of pendingInits) {
    if (p.afterPluginsReady) {
      try {
        const resolvedDeps: Record<string, unknown> = {};
        for (const [key, ref] of Object.entries(p.deps)) {
          resolvedDeps[key] = await deps.registry.get(
            ref as ServiceRef<unknown>,
            p.metadata,
          );
        }

        if (p.schema) {
          const assignedSchema = getPluginSchemaName(p.metadata.pluginId);
          resolvedDeps["database"] = createScopedDb(deps.db, assignedSchema);
        }

        const eventBus = await deps.registry.get(coreServices.eventBus, {
          pluginId: "core",
        });
        resolvedDeps["onHook"] = <T>(
          hook: { id: string },
          listener: (payload: T) => Promise<void>,
          options?: HookSubscribeOptions,
        ) => {
          return eventBus.subscribe(
            p.metadata.pluginId,
            hook,
            listener,
            options,
          );
        };
        resolvedDeps["emitHook"] = async <T>(
          hook: { id: string },
          payload: T,
        ) => {
          await eventBus.emit(hook, payload);
        };

        await p.afterPluginsReady(resolvedDeps);
        rootLogger.debug(
          `   -> ${p.metadata.pluginId} afterPluginsReady complete`,
        );
      } catch (error) {
        rootLogger.error(
          `❌ Failed afterPluginsReady for ${p.metadata.pluginId}:`,
          error,
        );
        throw new Error(
          `Failed afterPluginsReady for plugin ${p.metadata.pluginId}`,
          {
            cause: error,
          },
        );
      }
    }
  }
  rootLogger.debug("✅ All afterPluginsReady callbacks complete");
}

/**
 * Validate that all access rules used in a contract are registered with the plugin system.
 * Recursively traverses the contract to find all procedures and their access metadata.
 */
function validateContractAccessRules({
  pluginId,
  contract,
  registeredRuleIds,
  validationErrors,
}: {
  pluginId: string;
  contract: AnyContractRouter;
  registeredRuleIds: Set<string>;
  validationErrors: string[];
}): void {
  for (const [procedureName, procedure] of Object.entries(
    contract as Record<string, unknown>,
  )) {
    if (!procedure || typeof procedure !== "object") continue;

    // Check if this is a procedure with oRPC metadata
    const orpcData = (procedure as Record<string, unknown>)["~orpc"] as
      | { meta?: { access?: Array<{ id: string }> } }
      | undefined;

    if (orpcData?.meta?.access) {
      for (const accessRule of orpcData.meta.access) {
        const qualifiedId = `${pluginId}.${accessRule.id}`;
        if (!registeredRuleIds.has(qualifiedId)) {
          validationErrors.push(
            `Plugin "${pluginId}" procedure "${procedureName}" uses unregistered access rule "${accessRule.id}" (qualified: "${qualifiedId}"). ` +
              `Add it to the plugin's accessRules registration array.`,
          );
        }
      }
    }
  }
}
