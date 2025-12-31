import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";
import fs from "node:fs";
import type { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
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
} from "@checkmate/backend-api";
import type { Permission } from "@checkmate/common";
import { rootLogger } from "../logger";
import type { ServiceRegistry } from "../services/service-registry";
import { plugins } from "../schema";
import { fixMigrationsSchemaReferences } from "../utils/fix-migrations";
import {
  discoverLocalPlugins,
  syncPluginsToDatabase,
} from "../utils/plugin-discovery";
import type { InitCallback, PendingInit } from "./types";
import { sortPlugins } from "./dependency-sorter";
import { createApiRouteHandler, registerApiRoute } from "./api-router";
import type { ExtensionPointManager } from "./extension-points";

export interface PluginLoaderDeps {
  registry: ServiceRegistry;
  pluginRpcRouters: Map<string, unknown>;
  pluginHttpHandlers: Map<string, (req: Request) => Promise<Response>>;
  extensionPointManager: ExtensionPointManager;
  registeredPermissions: {
    pluginId: string;
    id: string;
    description?: string;
  }[];
  getAllPermissions: () => { id: string; description?: string }[];
  db: NodePgDatabase<Record<string, unknown>>;
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
        backendPlugin?.pluginId || "unknown"
      } is not using new API. Skipping.`
    );
    return;
  }

  // Execute Register
  backendPlugin.register({
    registerInit: <
      D extends Deps,
      S extends Record<string, unknown> | undefined = undefined
    >(args: {
      deps: D;
      schema?: S;
      init: (deps: ResolvedDeps<D> & DatabaseDeps<S>) => Promise<void>;
      afterPluginsReady?: (
        deps: ResolvedDeps<D> & DatabaseDeps<S> & AfterPluginsReadyContext
      ) => Promise<void>;
    }) => {
      pendingInits.push({
        pluginId: backendPlugin.pluginId,
        pluginPath: pluginPath,
        deps: args.deps,
        init: args.init as InitCallback,
        afterPluginsReady: args.afterPluginsReady as InitCallback | undefined,
        schema: args.schema,
      });
    },
    registerService: (ref: ServiceRef<unknown>, impl: unknown) => {
      deps.registry.register(ref, impl);
      providedBy.set(ref.id, backendPlugin.pluginId);
      rootLogger.debug(`   -> Registered service '${ref.id}'`);
    },
    registerExtensionPoint: (ref, impl) => {
      deps.extensionPointManager.registerExtensionPoint(ref, impl);
    },
    getExtensionPoint: (ref) => {
      return deps.extensionPointManager.getExtensionPoint(ref);
    },
    registerPermissions: (permissions: Permission[]) => {
      // Store permissions with pluginId for Phase 3 emission
      const prefixed = permissions.map((p) => ({
        pluginId: backendPlugin.pluginId,
        id: `${backendPlugin.pluginId}.${p.id}`,
        description: p.description,
      }));
      deps.registeredPermissions.push(...prefixed);
      rootLogger.debug(
        `   -> Registered ${prefixed.length} permissions for ${backendPlugin.pluginId}`
      );
    },
    registerRouter: (router: unknown) => {
      deps.pluginRpcRouters.set(backendPlugin.pluginId, router);
    },
    pluginManager: {
      getAllPermissions: () => deps.getAllPermissions(),
    },
  });
}

/**
 * Loads all plugins - main orchestration function.
 */
export async function loadPlugins({
  rootRouter,
  manualPlugins = [],
  deps,
}: {
  rootRouter: Hono;
  manualPlugins?: BackendPlugin[];
  deps: PluginLoaderDeps;
}) {
  rootLogger.info("🔍 Discovering plugins...");

  // 1. Discover local BACKEND plugins from monorepo using package.json metadata
  const workspaceRoot = path.join(__dirname, "..", "..", "..", "..");
  const localPlugins = discoverLocalPlugins({
    workspaceRoot,
    type: "backend",
  });

  rootLogger.debug(
    `   -> Found ${localPlugins.length} local backend plugin(s) in workspace`
  );
  rootLogger.debug("   -> Discovered plugins:");
  for (const p of localPlugins) {
    rootLogger.debug(`      • ${p.packageName}`);
  }

  // 2. Sync local plugins to database
  await syncPluginsToDatabase({ localPlugins, db: deps.db });

  // 3. Load all enabled BACKEND plugins from database
  const allPlugins = await deps.db
    .select()
    .from(plugins)
    .where(and(eq(plugins.enabled, true), eq(plugins.type, "backend")));

  rootLogger.debug(
    `   -> ${allPlugins.length} enabled backend plugins in database:`
  );
  for (const p of allPlugins) {
    rootLogger.debug(`      • ${p.name}`);
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
          `   -> Package name import failed, trying path: ${plugin.path}`
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
  const logger = await deps.registry.get(coreServices.logger, "core");
  const sortedIds = sortPlugins({ pendingInits, providedBy, logger });
  rootLogger.debug(`✅ Initialization Order: ${sortedIds.join(" -> ")}`);

  // Register /api/* route BEFORE plugin initialization
  const apiHandler = createApiRouteHandler({
    registry: deps.registry,
    pluginRpcRouters: deps.pluginRpcRouters,
    pluginHttpHandlers: deps.pluginHttpHandlers,
  });
  registerApiRoute(rootRouter, apiHandler);

  for (const id of sortedIds) {
    const p = pendingInits.find((x) => x.pluginId === id)!;
    rootLogger.info(`🚀 Initializing ${p.pluginId}...`);

    try {
      const pluginDb = await deps.registry.get(
        coreServices.database,
        p.pluginId
      );

      // Run Migrations
      const migrationsFolder = path.join(p.pluginPath, "drizzle");
      if (fs.existsSync(migrationsFolder)) {
        try {
          fixMigrationsSchemaReferences(migrationsFolder);
          rootLogger.debug(
            `   -> Running migrations for ${p.pluginId} from ${migrationsFolder}`
          );
          await migrate(pluginDb, { migrationsFolder });
        } catch (error) {
          rootLogger.error(
            `❌ Failed migration of plugin ${p.pluginId}:`,
            error
          );
        }
      } else {
        rootLogger.debug(
          `   -> No migrations found for ${p.pluginId} (skipping)`
        );
      }

      // Resolve Dependencies
      const resolvedDeps: Record<string, unknown> = {};
      for (const [key, ref] of Object.entries(p.deps)) {
        resolvedDeps[key] = await deps.registry.get(
          ref as ServiceRef<unknown>,
          p.pluginId
        );
      }

      // Inject Schema-aware Database if schema is provided
      if (p.schema) {
        const baseUrl = process.env.DATABASE_URL;
        const assignedSchema = `plugin_${p.pluginId}`;
        const scopedUrl = `${baseUrl}?options=-c%20search_path%3D${assignedSchema}`;
        const pluginPool = new Pool({ connectionString: scopedUrl });
        resolvedDeps["database"] = drizzle(pluginPool, { schema: p.schema });
      }

      try {
        await p.init(resolvedDeps);
        rootLogger.debug(`   -> Initialized ${p.pluginId}`);
      } catch (error) {
        rootLogger.error(`❌ Failed to initialize ${p.pluginId}:`, error);
      }
    } catch (error) {
      rootLogger.error(
        `❌ Critical error loading plugin ${p.pluginId}:`,
        error
      );
    }
  }

  // Phase 3: Run afterPluginsReady callbacks
  rootLogger.debug("🔄 Running afterPluginsReady callbacks...");

  // Emit permission registration hooks at start of Phase 3
  // (EventBus is now available, all plugins can receive notifications)
  const eventBus = await deps.registry.get(coreServices.eventBus, "core");
  const permissionsByPlugin = new Map<
    string,
    { id: string; description?: string }[]
  >();
  for (const perm of deps.registeredPermissions) {
    if (!permissionsByPlugin.has(perm.pluginId)) {
      permissionsByPlugin.set(perm.pluginId, []);
    }
    permissionsByPlugin
      .get(perm.pluginId)!
      .push({ id: perm.id, description: perm.description });
  }
  for (const [pluginId, permissions] of permissionsByPlugin) {
    try {
      await eventBus.emit(coreHooks.permissionsRegistered, {
        pluginId,
        permissions,
      });
    } catch (error) {
      rootLogger.error(
        `Failed to emit permissionsRegistered hook for ${pluginId}:`,
        error
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
            p.pluginId
          );
        }

        if (p.schema) {
          const baseUrl = process.env.DATABASE_URL;
          const assignedSchema = `plugin_${p.pluginId}`;
          const scopedUrl = `${baseUrl}?options=-c%20search_path%3D${assignedSchema}`;
          const pluginPool = new Pool({ connectionString: scopedUrl });
          resolvedDeps["database"] = drizzle(pluginPool, { schema: p.schema });
        }

        const eventBus = await deps.registry.get(coreServices.eventBus, "core");
        resolvedDeps["onHook"] = <T>(
          hook: { id: string },
          listener: (payload: T) => Promise<void>,
          options?: HookSubscribeOptions
        ) => {
          return eventBus.subscribe(p.pluginId, hook, listener, options);
        };
        resolvedDeps["emitHook"] = async <T>(
          hook: { id: string },
          payload: T
        ) => {
          await eventBus.emit(hook, payload);
        };

        await p.afterPluginsReady(resolvedDeps);
        rootLogger.debug(`   -> ${p.pluginId} afterPluginsReady complete`);
      } catch (error) {
        rootLogger.error(
          `❌ Failed afterPluginsReady for ${p.pluginId}:`,
          error
        );
      }
    }
  }
  rootLogger.debug("✅ All afterPluginsReady callbacks complete");
}
