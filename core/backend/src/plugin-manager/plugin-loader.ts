import path from "node:path";
import fs from "node:fs";
import type { Hono } from "hono";
import { eq, and } from "drizzle-orm";
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
import { runPluginMigrations } from "../utils/run-plugin-migrations";
import { adminPool } from "../db";
import {
  discoverLocalPlugins,
  syncPluginsToDatabase,
} from "../utils/plugin-discovery";
import type { InitCallback, PendingInit } from "./types";
import { sortPlugins } from "./dependency-sorter";
import {
  createApiRouteHandler,
  createRestRouteHandler,
  registerApiRoute,
  registerRestRoute,
} from "./api-router";
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
  /**
   * Called once `/api/:pluginId/*` is added to the root router and Phase 2
   * (per-plugin init) is about to start. From this point on, plugin RPC
   * routers come online incrementally as each plugin initializes — so
   * self-referencing HTTP calls (e.g. RPC made from `afterPluginsReady`)
   * can be allowed through the boot-time request gate without deadlocking.
   */
  onApiRouteRegistered?: () => void;
}

/**
 * Resolves a human-identifiable name for a plugin module so diagnostics never
 * render the opaque literal "unknown". Prefers the declared `pluginId`, then
 * the package name from the database/discovery row, then the on-disk path.
 */
function resolvePluginIdentifier({
  backendPlugin,
  pluginName,
  pluginPath,
}: {
  backendPlugin: BackendPlugin | undefined;
  pluginName?: string;
  pluginPath: string;
}): string {
  const pluginId = backendPlugin?.metadata?.pluginId;
  if (pluginId) {
    return pluginId;
  }
  if (pluginName) {
    return pluginName;
  }
  if (pluginPath) {
    return pluginPath;
  }
  return "unknown";
}

/**
 * Registers a single plugin - called during Phase 1.
 */
export function registerPlugin({
  backendPlugin,
  pluginPath,
  pluginName,
  pendingInits,
  providedBy,
  deps,
}: {
  /**
   * The plugin module's default export. Typed as possibly `undefined` because
   * a package mis-typed as `checkstack.type: "backend"` may have no default
   * export at all (`pluginModule.default` is `undefined` at runtime); the guard
   * below handles that case explicitly.
   */
  backendPlugin: BackendPlugin | undefined;
  pluginPath: string;
  /**
   * Package name of the plugin from its database/discovery row. Used so the
   * "no register() export" diagnostic can name the offending package even when
   * its module has no default export carrying `metadata.pluginId`.
   */
  pluginName?: string;
  pendingInits: PendingInit[];
  providedBy: Map<string, string>;
  deps: PluginLoaderDeps;
}) {
  if (!backendPlugin || typeof backendPlugin.register !== "function") {
    const identifier = resolvePluginIdentifier({
      backendPlugin,
      pluginName,
      pluginPath,
    });
    rootLogger.warn(
      `Plugin '${identifier}' has no backend register() export and was skipped. ` +
        `If this package is a host-consumed library rather than a runtime plugin, ` +
        `set its package.json "checkstack.type" to "tooling" so it is not discovered as a backend plugin.`,
    );
    return;
  }

  const pluginId = backendPlugin.metadata.pluginId;

  // Store metadata for request-time context injection
  deps.pluginMetadataRegistry.set(pluginId, backendPlugin.metadata);

  // Plugin dependencies derived from declared subscription specs.
  // Populated by `registerSubscriptionSpecs` below; attached to the
  // PendingInit when registerInit fires (a plugin's register block
  // calls registerInit at most once, so timing is deterministic
  // regardless of registration order within register()).
  const pluginDependencies = new Set<string>();

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
        pluginDependencies,
      });
    },
    registerSubscriptionSpecs: (specs) => {
      for (const spec of specs) {
        if (spec.ownerPlugin !== pluginId) {
          throw new Error(
            `Plugin ${pluginId} declared a subscription spec it does not own (ownerPlugin=${spec.ownerPlugin})`,
          );
        }
        const targetOwner = spec.target.ownerPlugin;
        if (targetOwner && targetOwner !== pluginId) {
          pluginDependencies.add(targetOwner);
        }
      }
    },
    registerService: (ref: ServiceRef<unknown>, impl: unknown) => {
      deps.registry.register(ref, impl);
      providedBy.set(ref.id, pluginId);
      rootLogger.debug(`   -> Registered service '${ref.id}'`);
    },
    // Registry-backed resolver for arbitrary cross-plugin refs. The
    // consumer identity is THIS plugin (`pluginId`), which is the correct
    // audit identity for scoped factories. `registry.get` throws a clear
    // error when the ref is unregistered, so a missing service (e.g. a
    // connection store the automation dispatch path needs) fails loudly
    // rather than silently resolving `undefined`.
    getService: <T>(ref: ServiceRef<T>): Promise<T> =>
      deps.registry.get(ref, { pluginId }),
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
  manualPluginPaths,
  skipDiscovery = false,
  deps,
}: {
  rootRouter: Hono;
  manualPlugins?: BackendPlugin[];
  /**
   * Optional `pluginId -> on-disk plugin dir` map for manually-loaded
   * plugins. When a manual plugin has an entry here, its Drizzle migrations
   * (in `<dir>/drizzle`) are applied just like a discovered plugin's. The
   * dev server passes the plugin's `CHECKSTACK_DEV_PLUGIN_PATH` here so a
   * scaffolded plugin's tables exist on first boot; without it, manual
   * plugins keep their historical `pluginPath: ""` (migrations skipped).
   */
  manualPluginPaths?: Map<string, string>;
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

    // 2.5 Bootstrap runtime-installed plugins missing from node_modules.
    // For every `is_uninstallable=true` row in `plugins`, ensure the
    // package is installed in the runtime dir. If not, fetch its tarball
    // from `plugin_artifacts` and run `bun install` so the import below
    // resolves. This is what lets a freshly spun replica recover the
    // full plugin set from Postgres alone.
    await bootstrapRuntimePlugins({ db: deps.db, registry: deps.registry });

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
        pluginName: plugin.name,
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
      // Use the supplied dir (dev server passes the plugin's path so its
      // migrations run); fall back to "" for manual plugins without one.
      pluginPath:
        manualPluginPaths?.get(backendPlugin.metadata.pluginId) ?? "",
      pendingInits,
      providedBy,
      deps,
    });
  }

  // Phase 2: Initialize Plugins (Topological Sort)
  //
  // Done in two passes over the topologically-sorted plugins:
  //   Pass 1 - run EVERY plugin's migrations.
  //   Pass 2 - resolve deps + run EVERY plugin's init().
  // Splitting the passes guarantees no plugin's init() (which may start
  // background DB work - queue consumers, sweepers, reactive-entity/event
  // wiring) is running while another plugin is still migrating. That
  // interleaving is what could divert a migration onto a pooled connection
  // without the plugin's search_path. `runPluginMigrations` pins a connection
  // too, so each measure is independently sufficient; together they make boot
  // robust regardless of what touches the pool.
  const logger = await deps.registry.get(coreServices.logger, {
    pluginId: "core",
  });
  const sortedIds = sortPlugins({ pendingInits, providedBy, logger });
  rootLogger.debug(`✅ Initialization Order: ${sortedIds.join(" -> ")}`);

  // Register /api/* (oRPC wire format) and /rest/* (REST/OpenAPI shape) routes
  // BEFORE plugin initialization. Both routes share the same plugin RPC routers
  // and per-request context; they differ only in how the handler decodes the
  // request and matches it to a procedure.
  const apiHandler = createApiRouteHandler({
    registry: deps.registry,
    pluginRpcRouters: deps.pluginRpcRouters,
    pluginHttpHandlers: deps.pluginHttpHandlers,
    pluginMetadataRegistry: deps.pluginMetadataRegistry,
  });
  registerApiRoute(rootRouter, apiHandler);

  const restHandler = createRestRouteHandler({
    registry: deps.registry,
    pluginRpcRouters: deps.pluginRpcRouters,
    pluginMetadataRegistry: deps.pluginMetadataRegistry,
  });
  registerRestRoute(rootRouter, restHandler);

  // Routes are now registered on the root router. Signal readiness so the
  // server can stop blocking incoming requests in `waitForInit()`. We open
  // the gate here (BEFORE Phase 2 / Phase 3) so that:
  //   - the static module-load endpoints (/api/plugins, /api/about, …) stop
  //     hanging behind the boot gate;
  //   - cross-plugin RPC calls made from `afterPluginsReady` can self-loop
  //     through the HTTP server without deadlocking on init completion.
  // Plugin RPC routers come online incrementally as each plugin's Phase 2
  // init runs; requests targeting a not-yet-initialized plugin fall through
  // to the api-router's "Plugin metadata not found" 500, which is the
  // pre-existing behavior and is preferable to a multi-second hang.
  deps.onApiRouteRegistered?.();

  // Phase 2, pass 1: run every plugin's migrations BEFORE any plugin init.
  for (const id of sortedIds) {
    const p = pendingInits.find((x) => x.metadata.pluginId === id)!;

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
       * ## Why a pinned connection (not a session-level SET on the pool)
       *
       * The migration `search_path` MUST be set on the exact connection the
       * migration statements run on. Setting it at the session level on the
       * shared `adminPool` does not achieve that: `migrate()` runs all pending
       * migrations inside its own transaction, which a `pg.Pool` may service on
       * a *different* physical connection than the `SET` ran on. The migration
       * SQL would then execute against `public`.
       *
       * `runPluginMigrations()` therefore checks out ONE dedicated client from
       * the pool, sets `search_path` on it, and binds the migrator to that same
       * client - the same connection-affinity pattern the advisory-lock service
       * uses (see `advisory-lock.ts`). The bug this prevents is invisible on a
       * fresh database (every object is created in one transaction, so
       * unqualified references still resolve) but breaks UPGRADES: a new
       * migration that references an enum an earlier migration created in the
       * plugin schema fails with `type "..." does not exist`.
       *
       * ## Why This Doesn't Affect Runtime Queries
       *
       * After migrations complete, plugins receive their database via
       * `createScopedDb()` which wraps every query in a transaction with
       * `SET LOCAL search_path`. This ensures runtime queries always use the
       * correct schema.
       *
       * @see runPluginMigrations in ../utils/run-plugin-migrations.ts
       * @see createScopedDb in ../utils/scoped-db.ts for runtime query isolation
       * @see getPluginSchemaName in @checkstack/drizzle-helper for schema naming
       * =======================================================================
       */

      // Run Migrations
      // Skip migrations for manual test plugins (no plugin path) - see comment above
      const migrationsFolder = p.pluginPath
        ? path.join(p.pluginPath, "drizzle")
        : undefined;
      const migrationsSchema = getPluginSchemaName(p.metadata.pluginId);
      if (migrationsFolder && fs.existsSync(migrationsFolder)) {
        try {
          // Strip "public". schema references from migration SQL at runtime
          stripPublicSchemaFromMigrations(migrationsFolder);
          rootLogger.debug(
            `   -> Running migrations for ${p.metadata.pluginId} from ${migrationsFolder}`,
          );

          // Run on a single pinned connection so the search_path we set is the
          // one the migration statements actually execute under.
          await runPluginMigrations({
            pool: adminPool,
            migrationsFolder,
            migrationsSchema,
          });
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

  // Phase 2, pass 2: initialize plugins in topological order. Every plugin -
  // and therefore every dependency - is fully migrated by now, so an init()
  // can assume all plugin schemas exist.
  for (const id of sortedIds) {
    const p = pendingInits.find((x) => x.metadata.pluginId === id)!;
    rootLogger.info(`🚀 Initializing ${p.metadata.pluginId}...`);

    try {
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
  /**
   * Boot-time hook policy for `pluginInitialized`: HALT on subscriber
   * failure.
   *
   * Rationale: `pluginInitialized` fires immediately after a plugin's
   * Phase 2 `init()` resolves. A throwing subscriber here means a
   * structural problem with that plugin's startup (a downstream
   * consumer never got the chance to wire itself against the freshly
   * initialized plugin). Continuing past such a failure would leave
   * the platform running in a half-wired state — surfacing it during
   * boot is safer than discovering the missing wiring at request time.
   *
   * Matches the `afterPluginsReady` failure handling below (log +
   * rethrow with a clearer message naming the failing plugin).
   *
   * See `docs/src/content/docs/backend/plugin-hook-policy.md`.
   */
  for (const p of pendingInits) {
    try {
      await eventBus.emit(coreHooks.pluginInitialized, {
        pluginId: p.metadata.pluginId,
      });
    } catch (error) {
      rootLogger.error(
        `❌ pluginInitialized hook subscriber threw for ${p.metadata.pluginId}; halting boot to avoid an inconsistent platform state:`,
        error,
      );
      throw new Error(
        `Failed pluginInitialized hook for plugin ${p.metadata.pluginId}`,
        { cause: error },
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
  for (const rule of deps.registeredAccessRules) {
    // Keep `pluginId` on the rule (required AccessRule field); use it only to
    // group. The rule's `id` is already fully-qualified.
    const { pluginId } = rule;
    if (!accessRulesByPlugin.has(pluginId)) {
      accessRulesByPlugin.set(pluginId, []);
    }
    accessRulesByPlugin.get(pluginId)!.push(rule);
  }
  /**
   * Boot-time hook policy for `accessRulesRegistered`: CONTINUE on
   * subscriber failure, escalate the log to `error`.
   *
   * Rationale: this hook drives downstream consumers that mirror
   * access-rule registrations into their own stores (e.g. an
   * access-rule sync worker that hydrates a DB cache). A single
   * misbehaving subscriber here MUST NOT be allowed to block the
   * entire platform from booting — that would let one buggy plugin
   * DOS every other plugin on the same instance.
   *
   * We deliberately diverge from the `pluginInitialized` policy
   * because the failure mode is operational (a downstream's cache is
   * stale until it recovers), not structural (the platform itself is
   * fully wired even if a subscriber threw). Boot continues, the
   * loud `error` log surfaces the breakage to operators, and the
   * subscriber's owning plugin can implement its own retry / repair.
   *
   * See `docs/src/content/docs/backend/plugin-hook-policy.md`.
   */
  let accessRulesHookFailures = 0;
  for (const [pluginId, accessRules] of accessRulesByPlugin) {
    try {
      await eventBus.emit(coreHooks.accessRulesRegistered, {
        pluginId,
        accessRules,
      });
    } catch (error) {
      accessRulesHookFailures += 1;
      rootLogger.error(
        `❌ accessRulesRegistered hook subscriber threw for ${pluginId}; continuing boot (a single misbehaving plugin must not block the platform). Downstream consumers may have a stale view of this plugin's access rules until they recover:`,
        error,
      );
    }
  }
  if (accessRulesHookFailures > 0) {
    rootLogger.error(
      `❌ ${accessRulesHookFailures} accessRulesRegistered hook subscriber(s) failed during boot. Platform continued but downstream access-rule consumers may be stale.`,
    );
  }
  // Run afterPluginsReady in topologically-sorted order, matching Phase
  // 2 init order. Iterating `pendingInits` directly would use registration
  // order, which races dependency chains: e.g. catalog's
  // afterPluginsReady registers `catalog.group` as a notification target,
  // and emitting plugins' afterPluginsReady call `registerSubscriptionSpec`
  // against it — so the emitters MUST run after catalog. Topo order
  // already encodes this dependency (via spec.target.ownerPlugin).
  for (const id of sortedIds) {
    const p = pendingInits.find((x) => x.metadata.pluginId === id)!;
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

/**
 * Fresh-instance bootstrap.
 *
 * Walks every `is_uninstallable=true` row in the `plugins` table and ensures
 * the corresponding package is installed under the runtime dir. Missing
 * packages are recovered from `plugin_artifacts` (bytea) and installed with
 * `bun install --no-save --ignore-scripts`. Once this returns, the normal
 * `pluginModule = await import(...)` in Phase 1 below resolves.
 */
async function bootstrapRuntimePlugins({
  db,
  registry,
}: {
  db: SafeDatabase<Record<string, unknown>>;
  registry: ServiceRegistry;
}): Promise<void> {
  const installerRegistry = await registry
    .get(coreServices.pluginInstallerRegistry, { pluginId: "core" })
    .catch(() => {});
  const artifactStore = await registry
    .get(coreServices.pluginArtifactStore, { pluginId: "core" })
    .catch(() => {});
  if (!installerRegistry || !artifactStore) {
    rootLogger.debug(
      "   -> Skipping runtime plugin bootstrap (services not registered)",
    );
    return;
  }

  const remoteRows = await db
    .select()
    .from(plugins)
    .where(eq(plugins.isUninstallable, true));

  for (const row of remoteRows) {
    if (!row.path) continue;
    const pkgJsonPath = path.join(row.path, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      rootLogger.debug(`   -> ${row.name} already present, skipping bootstrap`);
      continue;
    }
    rootLogger.info(
      `🔌 Bootstrapping runtime plugin from artifact store: ${row.name}@${row.version}`,
    );
    const artifact = await artifactStore.fetch({
      pluginName: row.name,
      version: row.version,
    });
    if (!artifact) {
      rootLogger.warn(
        `   -> No artifact for ${row.name}@${row.version} — skipping. Re-install from the original source.`,
      );
      continue;
    }
    const allowInstallScripts =
      (row.metadata as { checkstack?: { allowInstallScripts?: boolean } })
        ?.checkstack?.allowInstallScripts === true;
    await installerRegistry.forSource("npm").installFromArtifact({
      tarball: artifact.tarball,
      pluginName: row.name,
      allowInstallScripts,
    });
  }
}
