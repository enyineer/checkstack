import type { Hono } from "hono";
import path from "node:path";
import fs from "node:fs";
import { adminPool, db } from "./db";
import { ServiceRegistry } from "./services/service-registry";
import type { CoreCollectorRegistry } from "./services/collector-registry";
import type { WebSocketRouteStoreImpl } from "./services/ws-route-registry";
import type { CoreReadinessRegistry } from "./services/readiness-registry";
import {
  BackendPlugin,
  ServiceRef,
  ExtensionPoint,
  coreServices,
  coreHooks,
  HookUnsubscribe,
} from "@checkstack/backend-api";
import type { AnyContractRouter } from "@orpc/contract";
import type { AccessRule, PluginMetadata } from "@checkstack/common";
import { extractErrorMessage } from "@checkstack/common";

// Extracted modules
import { registerCoreServices } from "./plugin-manager/core-services";
import { createExtensionPointManager } from "./plugin-manager/extension-points";
import { loadPlugins as loadPluginsImpl } from "./plugin-manager/plugin-loader";
import { rootLogger } from "./logger";
import type { PluginEventRecorder } from "./services/plugin-event-recorder";
import { installBundleFromArtifacts } from "./services/plugin-installers/install-from-tarball";
import { getPluginSchemaName } from "@checkstack/drizzle-helper";
import { stripPublicSchemaFromMigrations } from "./utils/strip-public-schema";
import { runPluginMigrations } from "./utils/run-plugin-migrations";
import { createScopedDb } from "./utils/scoped-db";

export interface DeregisterOptions {
  deleteSchema: boolean;
}

export class PluginManager {
  private registry = new ServiceRegistry();
  private pluginRpcRouters = new Map<string, unknown>();
  private pluginHttpHandlers = new Map<
    string,
    (req: Request) => Promise<Response>
  >();
  private extensionPointManager = createExtensionPointManager();

  // Access rule registry - stores all registered access rules with pluginId for hook emission
  private registeredAccessRules: (AccessRule & { pluginId: string })[] = [];

  // Plugin metadata registry - stores PluginMetadata for request-time context injection
  private pluginMetadataRegistry = new Map<string, PluginMetadata>();

  // Cleanup handlers registered by plugins (LIFO execution)
  private cleanupHandlers = new Map<string, Array<() => Promise<void>>>();

  // Contract registry - stores plugin contracts for OpenAPI generation
  private pluginContractRegistry = new Map<string, AnyContractRouter>();

  // Hook subscriptions per plugin (for bulk unsubscribe)
  private hookSubscriptions = new Map<string, HookUnsubscribe[]>();

  // Global collector registry reference for cleanup
  private collectorRegistry: CoreCollectorRegistry;

  // Global WebSocket route store for server-level routing
  private wsStore: WebSocketRouteStoreImpl;

  // Global readiness registry — plugins contribute probes, /ready aggregates them
  private readinessRegistry: CoreReadinessRegistry;

  // Audit/error event recorder — wired post-construction in index.ts.
  private eventRecorder: PluginEventRecorder | undefined;

  // Filesystem location plugins are installed into at runtime (set in
  // index.ts). The runtime install pipeline reads from here on bootstrap
  // and writes to here when handling broadcast install hooks.
  private runtimeDir: string | undefined;

  // In-process dedupe for bundle installs: the install broadcast fans out one
  // `pluginInstallationRequested` event PER package, so all siblings of a
  // bundle race to install the same set of tarballs into `runtimeDir`. Keyed
  // by bundleId, the first handler runs the single co-install and the rest
  // await the same promise (cross-pod isolation is inherent — each pod has its
  // own filesystem and its own map).
  private bundleInstallLocks = new Map<string, Promise<void>>();

  // Resolves once `/api/:pluginId/*` is registered on the root router and
  // Phase 2 (per-plugin init) is starting. The HTTP server awaits this
  // promise to know when it is safe to stop gating incoming requests.
  // Held as a deferred so the listener (server) can be wired up before
  // loadPlugins() runs.
  private resolveRoutesReady!: () => void;
  readonly routesReadyPromise: Promise<void>;

  constructor() {
    this.routesReadyPromise = new Promise<void>((resolve) => {
      this.resolveRoutesReady = resolve;
    });
    const registries = registerCoreServices({
      registry: this.registry,
      adminPool,
      pluginRpcRouters: this.pluginRpcRouters,
      pluginHttpHandlers: this.pluginHttpHandlers,
      pluginContractRegistry: this.pluginContractRegistry,
    });
    this.collectorRegistry = registries.collectorRegistry;
    this.wsStore = registries.wsStore;
    this.readinessRegistry = registries.readinessRegistry;
  }

  /**
   * Register access rules owned by a core router (not a regular plugin).
   * Used by `pluginmanager` and other built-in admin endpoints whose access
   * rules need to be visible to the autoAuthMiddleware.
   */
  registerCoreAccessRules(
    pluginId: string,
    accessRules: AccessRule[],
  ): void {
    const prefixed = accessRules.map((rule) => ({
      ...rule,
      pluginId,
      id: `${pluginId}.${rule.id}`,
    }));
    this.registeredAccessRules.push(...prefixed);
  }

  /**
   * Register plugin metadata owned by a core router. The /api/:pluginId/*
   * dispatcher in api-router.ts looks up `pluginMetadataRegistry` to build
   * the RpcContext and 500s with "Plugin metadata not found in registry"
   * when the lookup misses. Regular plugins populate the registry as part
   * of their register() lifecycle; core routers (which never go through
   * that lifecycle) need to call this method to register theirs.
   */
  registerCorePluginMetadata(metadata: PluginMetadata): void {
    this.pluginMetadataRegistry.set(metadata.pluginId, metadata);
  }

  /**
   * Expose the underlying ServiceRegistry to internal core code. Plugins
   * should NEVER touch this directly — they go through the registered
   * service refs.
   */
  getRegistry(): ServiceRegistry {
    return this.registry;
  }

  setEventRecorder(recorder: PluginEventRecorder): void {
    this.eventRecorder = recorder;
  }

  getEventRecorder(): PluginEventRecorder | undefined {
    return this.eventRecorder;
  }

  setRuntimeDir(dir: string): void {
    this.runtimeDir = dir;
  }

  getRuntimeDir(): string | undefined {
    return this.runtimeDir;
  }

  /**
   * Get the global readiness registry so the server-level /ready endpoint
   * can aggregate plugin-contributed probes.
   */
  getReadinessRegistry(): CoreReadinessRegistry {
    return this.readinessRegistry;
  }

  /**
   * Get the global WebSocket route store for the backend server to use
   * during WebSocket upgrade routing.
   */
  getWsStore(): WebSocketRouteStoreImpl {
    return this.wsStore;
  }

  registerExtensionPoint<T>(ref: ExtensionPoint<T>, impl: T) {
    this.extensionPointManager.registerExtensionPoint(ref, impl);
  }

  getExtensionPoint<T>(ref: ExtensionPoint<T>): T {
    return this.extensionPointManager.getExtensionPoint(ref);
  }

  /**
   * Register a core router (not from a plugin, but from core backend).
   * Used for admin endpoints like plugin installation/deregistration.
   */
  registerCoreRouter(routerId: string, router: unknown): void {
    this.pluginRpcRouters.set(routerId, router);
  }

  getAllAccessRules(): AccessRule[] {
    return this.registeredAccessRules.map(
      ({ pluginId: _pluginId, ...rule }) => rule
    );
  }

  /**
   * Get all registered contracts for OpenAPI generation.
   * Returns a map of pluginId -> contract.
   */
  getAllContracts(): Map<string, AnyContractRouter> {
    return new Map(this.pluginContractRegistry);
  }

  async loadPlugins(
    rootRouter: Hono,
    manualPlugins: BackendPlugin[] = [],
    options: {
      skipDiscovery?: boolean;
      manualPluginPaths?: Map<string, string>;
    } = {}
  ) {
    await loadPluginsImpl({
      rootRouter,
      manualPlugins,
      manualPluginPaths: options.manualPluginPaths,
      skipDiscovery: options.skipDiscovery,
      deps: {
        registry: this.registry,
        pluginRpcRouters: this.pluginRpcRouters,
        pluginHttpHandlers: this.pluginHttpHandlers,
        extensionPointManager: this.extensionPointManager,
        registeredAccessRules: this.registeredAccessRules,
        getAllAccessRules: () => this.getAllAccessRules(),
        db,
        pluginMetadataRegistry: this.pluginMetadataRegistry,
        cleanupHandlers: this.cleanupHandlers,
        pluginContractRegistry: this.pluginContractRegistry,
        onApiRouteRegistered: () => this.resolveRoutesReady(),
      },
    });
    // Defensive: if loadPlugins returned without ever calling the callback
    // (e.g. zero plugins discovered and no api route registered), unblock
    // the server gate anyway — by this point Hono is fully configured.
    this.resolveRoutesReady();
  }

  /**
   * In-process teardown of a plugin. Runs on EVERY instance that receives
   * the deregistration broadcast (the originator AND all replicas).
   *
   * Strictly memory-only: clears registries, runs cleanup handlers, removes
   * collectors and access rules. **Does NOT touch shared persistent state**
   * (Postgres schemas, plugin_configs, plugin_artifacts, plugins rows) —
   * destructive cleanup is the originator's job, see `deletePluginData`.
   */
  async deregisterPluginInProcess(pluginId: string): Promise<void> {
    rootLogger.info(`🔄 Deregistering plugin in-process: ${pluginId}...`);

    const eventBus = await this.registry.get(coreServices.eventBus, {
      pluginId: "core",
    });
    await eventBus.emitLocal(coreHooks.pluginDeregistering, {
      pluginId,
      reason: "uninstall" as const,
    });

    const handlers = this.cleanupHandlers.get(pluginId) || [];
    for (const handler of handlers.toReversed()) {
      try {
        await handler();
      } catch (error) {
        rootLogger.error(`Cleanup handler failed for ${pluginId}:`, error);
      }
    }
    this.cleanupHandlers.delete(pluginId);

    const subscriptions = this.hookSubscriptions.get(pluginId) || [];
    for (const unsubscribe of subscriptions) {
      try {
        await unsubscribe();
      } catch (error) {
        rootLogger.error(`Failed to unsubscribe hook for ${pluginId}:`, error);
      }
    }
    this.hookSubscriptions.delete(pluginId);

    this.pluginRpcRouters.delete(pluginId);
    this.pluginHttpHandlers.delete(pluginId);
    this.pluginContractRegistry.delete(pluginId);
    this.pluginMetadataRegistry.delete(pluginId);

    this.collectorRegistry.unregisterByOwner(pluginId);
    const loadedPluginIds = new Set(
      [...this.pluginMetadataRegistry.keys()].filter((id) => id !== pluginId),
    );
    this.collectorRegistry.unregisterByMissingStrategies(loadedPluginIds);

    this.registeredAccessRules = this.registeredAccessRules.filter(
      (p) => p.pluginId !== pluginId,
    );

    await eventBus.emit(coreHooks.pluginDeregistered, { pluginId });
    rootLogger.info(`✅ Plugin deregistered in-process: ${pluginId}`);
  }

  /**
   * Originator-only destructive cleanup.
   *
   * Runs AFTER `deregisterPluginInProcess` has been broadcast and acked
   * across all instances. Drops the plugin's Postgres schema, deletes its
   * plugin_configs rows, deletes the artifact, deletes the `plugins` row.
   *
   * Multiple instances must NOT call this concurrently — coordination via
   * the originator's request handler is the contract.
   */
  async deletePluginData({
    pluginIds,
    bundleId,
    deleteSchema,
    deleteConfigs,
  }: {
    pluginIds: string[];
    bundleId?: string | null;
    deleteSchema: boolean;
    deleteConfigs: boolean;
  }): Promise<void> {
    rootLogger.info(
      `🗑 Originator: cleaning up data for ${pluginIds.join(", ")}...`,
    );

    const { plugins, pluginConfigs } = await import("./schema");
    const { inArray, eq, and } = await import("drizzle-orm");

    if (deleteSchema) {
      for (const pluginId of pluginIds) {
        try {
          const schemaName = `plugin_${pluginId}`;
          await db.execute(
            `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
          );
          rootLogger.info(`   -> Dropped schema: ${schemaName}`);
        } catch (error) {
          rootLogger.error(`Failed to drop schema for ${pluginId}:`, error);
        }
      }
    }

    if (deleteConfigs) {
      await db
        .delete(pluginConfigs)
        .where(inArray(pluginConfigs.pluginId, pluginIds));
      rootLogger.debug(`   -> Deleted plugin_configs rows`);
    }

    const artifactStore = await this.registry.get(
      coreServices.pluginArtifactStore,
      { pluginId: "core" },
    );
    if (bundleId) {
      await artifactStore.deleteByBundle({ bundleId });
    } else {
      for (const pluginName of pluginIds) {
        await artifactStore.delete({ pluginName });
      }
    }
    rootLogger.debug(`   -> Deleted plugin_artifacts rows`);

    await (bundleId ? db.delete(plugins).where(eq(plugins.bundleId, bundleId)) : db.delete(plugins).where(
        and(
          inArray(plugins.name, pluginIds),
          eq(plugins.isUninstallable, true),
        ),
      ));
    rootLogger.info(`✅ Originator: data cleanup complete`);
  }

  /**
   * Track a hook subscription for a plugin (for bulk unsubscribe during deregistration)
   */
  trackHookSubscription(pluginId: string, unsubscribe: HookUnsubscribe): void {
    const existing = this.hookSubscriptions.get(pluginId) || [];
    existing.push(unsubscribe);
    this.hookSubscriptions.set(pluginId, existing);
  }

  /**
   * Originator-side: broadcast in-process deregistration to all instances.
   * Carries plugin ids only — no destructive flags. Destructive ops happen
   * locally on the originator after the broadcast settles
   * (see `deletePluginData`).
   */
  async broadcastDeregistration(pluginIds: string[]): Promise<void> {
    rootLogger.info(`📢 Broadcasting deregistration: ${pluginIds.join(", ")}`);
    const eventBus = await this.registry.get(coreServices.eventBus, {
      pluginId: "core",
    });
    for (const pluginId of pluginIds) {
      await eventBus.emit(coreHooks.pluginDeregistrationRequested, {
        pluginId,
        deleteSchema: false, // unused by listeners now — destructive ops are originator-only
      });
    }
  }

  /**
   * Originator-side: broadcast in-process installation to all instances.
   * Each receiver pulls the artifact from `plugin_artifacts` and loads.
   */
  async broadcastInstallation(pluginIds: string[]): Promise<void> {
    rootLogger.info(`📢 Broadcasting installation: ${pluginIds.join(", ")}`);
    const eventBus = await this.registry.get(coreServices.eventBus, {
      pluginId: "core",
    });
    for (const pluginId of pluginIds) {
      await eventBus.emit(coreHooks.pluginInstallationRequested, {
        pluginId,
        pluginPath: "", // ignored — receivers resolve via plugin_artifacts
      });
    }
  }

  /**
   * Setup lifecycle listeners for multi-instance coordination.
   * Must be called after EventBus is available (after loadPlugins).
   */
  async setupLifecycleListeners(): Promise<void> {
    const eventBus = await this.registry.get(coreServices.eventBus, {
      pluginId: "core",
    });

    // Listen for deregistration broadcasts (from any instance) — every
    // instance does in-process teardown only. Originator separately runs
    // `deletePluginData` after the broadcast settles.
    await eventBus.subscribe(
      "core",
      coreHooks.pluginDeregistrationRequested,
      async ({ pluginId }) => {
        rootLogger.info(`📥 Received deregistration request for: ${pluginId}`);
        try {
          await this.deregisterPluginInProcess(pluginId);
          await this.eventRecorder?.record({
            pluginName: pluginId,
            action: "uninstall",
            phase: "in-process-unload",
            status: "succeeded",
          });
        } catch (error) {
          await this.eventRecorder?.record({
            pluginName: pluginId,
            action: "uninstall",
            phase: "in-process-unload",
            status: "failed",
            error: extractErrorMessage(error),
          });
          throw error;
        }
      },
    );

    // Listen for installation broadcasts (from any instance) — every
    // instance hydrates the artifact (if not already on disk) then loads.
    await eventBus.subscribe(
      "core",
      coreHooks.pluginInstallationRequested,
      async ({ pluginId }) => {
        rootLogger.info(`📥 Received installation request for: ${pluginId}`);
        try {
          await this.hydrateAndLoadPlugin(pluginId);
          await this.eventRecorder?.record({
            pluginName: pluginId,
            action: "install",
            phase: "in-process-load",
            status: "succeeded",
          });
        } catch (error) {
          await this.eventRecorder?.record({
            pluginName: pluginId,
            action: "install",
            phase: "in-process-load",
            status: "failed",
            error: extractErrorMessage(error),
          });
          throw error;
        }
      },
    );

    rootLogger.debug("🔗 Lifecycle listeners registered");
  }

  async getService<T>(ref: ServiceRef<T>): Promise<T | undefined> {
    try {
      return await this.registry.get(ref, { pluginId: "core" });
    } catch {
      return undefined;
    }
  }

  registerService<T>(ref: ServiceRef<T>, impl: T) {
    this.registry.register(ref, impl);
  }

  /**
   * Resolve a plugin's `plugins` row, fetch its artifact from the artifact
   * store (or original `PluginSource` as a fallback), install it into the
   * runtime dir if not present, and run `loadSinglePlugin`. Used by both
   * the installation broadcast handler AND the fresh-instance bootstrap
   * step in `loadPlugins`.
   */
  async hydrateAndLoadPlugin(pluginId: string): Promise<void> {
    const { plugins: pluginsTable } = await import("./schema");
    const { eq } = await import("drizzle-orm");

    const rows = await db
      .select()
      .from(pluginsTable)
      .where(eq(pluginsTable.name, pluginId))
      .limit(1);

    if (rows.length === 0) {
      throw new Error(`Plugin '${pluginId}' has no row in 'plugins' table`);
    }
    const row = rows[0];

    // Fast path: monorepo-local plugin, just load by package name / path.
    if (!row.isUninstallable) {
      if (row.type === "backend") {
        await this.loadSinglePlugin(pluginId, row.path);
      }
      return;
    }

    if (!this.runtimeDir) {
      throw new Error(
        `Runtime plugin dir not configured — call setRuntimeDir before hydrating runtime plugins.`,
      );
    }

    const pkgDir = path.join(this.runtimeDir, "node_modules", pluginId);
    if (!fs.existsSync(path.join(pkgDir, "package.json"))) {
      // Module not installed yet — pull from the artifact store and install.
      if (row.bundleId) {
        // Multi-package bundle: install ALL siblings in one `bun install` so a
        // sibling that depends on another sibling resolves from the bundled
        // tarballs instead of 404ing against a registry (the siblings are
        // shipped inside the bundle and are usually unpublished). Deduped per
        // bundleId so the parallel per-package broadcast handlers cooperate.
        await this.ensureBundleInstalled(row.bundleId);
      } else {
        const artifactStore = await this.registry.get(
          coreServices.pluginArtifactStore,
          { pluginId: "core" },
        );
        const artifact = await artifactStore.fetch({
          pluginName: pluginId,
          version: row.version,
        });
        if (!artifact) {
          throw new Error(
            `No tarball found in plugin_artifacts for ${pluginId}@${row.version}. ` +
              `The plugin row exists but its artifact is missing — re-install from the original source.`,
          );
        }
        const allowInstallScripts =
          (row.metadata as { checkstack?: { allowInstallScripts?: boolean } })
            ?.checkstack?.allowInstallScripts === true;

        const installerRegistry = await this.registry.get(
          coreServices.pluginInstallerRegistry,
          { pluginId: "core" },
        );
        // Any installer's installFromArtifact does the same thing (delegates
        // to the shared install-from-tarball helper) — pick npm.
        await installerRegistry
          .forSource("npm")
          .installFromArtifact({
            tarball: artifact.tarball,
            pluginName: pluginId,
            allowInstallScripts,
          });
      }
    }

    // Only BACKEND packages register as backend plugins. A bundle's `common`
    // (a plain library) and `frontend` (served to the browser via
    // /api/plugins) siblings still need to be installed on disk — done above —
    // but they export no `BackendPlugin`, so loading them here would throw.
    // This mirrors the fresh-instance bootstrap, which installs every package
    // but only imports `type = 'backend'` rows.
    if (row.type === "backend") {
      await this.loadSinglePlugin(pluginId, pkgDir);
    }
  }

  /**
   * Install every package of a bundle into `runtimeDir` in a single
   * `bun install`, deduped per bundleId so the N parallel per-package install
   * broadcasts run it exactly once. Resolves when the bundle is on disk.
   */
  private async ensureBundleInstalled(bundleId: string): Promise<void> {
    const inflight = this.bundleInstallLocks.get(bundleId);
    if (inflight) return inflight;
    const promise = this.installBundleNow(bundleId).finally(() => {
      this.bundleInstallLocks.delete(bundleId);
    });
    this.bundleInstallLocks.set(bundleId, promise);
    return promise;
  }

  private async installBundleNow(bundleId: string): Promise<void> {
    if (!this.runtimeDir) {
      throw new Error(
        `Runtime plugin dir not configured — call setRuntimeDir before hydrating runtime plugins.`,
      );
    }
    const { plugins: pluginsTable } = await import("./schema");
    const { eq } = await import("drizzle-orm");

    const siblings = await db
      .select()
      .from(pluginsTable)
      .where(eq(pluginsTable.bundleId, bundleId));
    if (siblings.length === 0) {
      throw new Error(`Bundle '${bundleId}' has no rows in 'plugins' table`);
    }

    const artifactStore = await this.registry.get(
      coreServices.pluginArtifactStore,
      { pluginId: "core" },
    );
    const packages: Array<{ tarball: Uint8Array; pluginName: string }> = [];
    for (const sib of siblings) {
      const artifact = await artifactStore.fetch({
        pluginName: sib.name,
        version: sib.version,
      });
      if (!artifact) {
        throw new Error(
          `No tarball found in plugin_artifacts for ${sib.name}@${sib.version} ` +
            `(bundle ${bundleId}). Re-install from the original source.`,
        );
      }
      packages.push({ tarball: artifact.tarball, pluginName: sib.name });
    }

    // `--ignore-scripts` is all-or-nothing for one command; gate on the
    // primary package the operator chose to trust.
    const primary = siblings.find((s) => s.isPrimary) ?? siblings[0];
    const allowInstallScripts =
      (primary.metadata as { checkstack?: { allowInstallScripts?: boolean } })
        ?.checkstack?.allowInstallScripts === true;

    await installBundleFromArtifacts({
      packages,
      allowInstallScripts,
      runtimeDir: this.runtimeDir,
    });
  }

  /**
   * Register + initialize an installed plugin module.
   *
   * Pre-condition: the package must already be importable (either monorepo
   * source via the workspace, or installed under `runtime_plugins/node_modules`
   * by `hydrateAndLoadPlugin`).
   */
  async loadSinglePlugin(pluginId: string, pluginPath: string): Promise<void> {
    rootLogger.info(`🔌 Loading plugin at runtime: ${pluginId}`);

    const eventBus = await this.registry.get(coreServices.eventBus, {
      pluginId: "core",
    });
    await eventBus.emitLocal(coreHooks.pluginInstalling, { pluginId });

    try {
      let pluginModule;

      try {
        pluginModule = await import(pluginId);
      } catch {
        try {
          pluginModule = await import(pluginPath);
        } catch (error) {
          throw new Error(
            `Plugin ${pluginId} module not available locally — call hydrateAndLoadPlugin instead, or check that the plugin is correctly installed.`,
            { cause: error },
          );
        }
      }

      const backendPlugin: BackendPlugin = pluginModule.default;

      if (!backendPlugin || typeof backendPlugin.register !== "function") {
        throw new Error(
          `Plugin ${pluginId} does not export a valid BackendPlugin`
        );
      }

      const metaPluginId = backendPlugin.metadata.pluginId;

      // Store metadata for request-time context injection
      this.pluginMetadataRegistry.set(metaPluginId, backendPlugin.metadata);

      // 2. Register plugin (Phase 1)
      const pendingInits: { pluginId: string; init: () => Promise<void> }[] =
        [];

      backendPlugin.register({
        registerInit: (args) => {
          pendingInits.push({
            pluginId: metaPluginId,
            init: async () => {
              // Resolve dependencies
              const resolvedDeps: Record<string, unknown> = {};
              for (const [key, ref] of Object.entries(args.deps)) {
                resolvedDeps[key] = await this.registry.get(
                  ref as ServiceRef<unknown>,
                  backendPlugin.metadata
                );
              }
              // Inject the plugin-scoped database when a schema is declared —
              // mirrors the full-system loader (plugin-loader Phase 2). Without
              // this the `database` init arg is undefined and the plugin's
              // service throws on its first query.
              if (args.schema) {
                resolvedDeps["database"] = createScopedDb(
                  db,
                  getPluginSchemaName(metaPluginId),
                );
              }
              await args.init(resolvedDeps as never);
            },
          });
        },
        registerAccessRules: (accessRules) => {
          const prefixed = accessRules.map((p) => ({
            ...p,
            id: `${metaPluginId}.${p.id}`,
            pluginId: metaPluginId,
          }));
          this.registeredAccessRules.push(...prefixed);

          // Emit access rule hook
          eventBus.emit(coreHooks.accessRulesRegistered, {
            pluginId: metaPluginId,
            accessRules: prefixed,
          });
        },
        registerService: (ref, impl) => {
          this.registry.register(ref, impl);
        },
        // Registry-backed resolver for arbitrary cross-plugin refs, using
        // this plugin's identity as the consumer. Mirrors the plugin-loader
        // `env.getService`; resolves through the real ServiceRegistry and
        // throws clearly on a missing ref (never silently undefined).
        getService: <T>(ref: ServiceRef<T>) =>
          this.registry.get(ref, backendPlugin.metadata),
        registerExtensionPoint: (ref, impl) => {
          this.extensionPointManager.registerExtensionPoint(ref, impl);
        },
        registerCleanup: (cleanup) => {
          const handlers = this.cleanupHandlers.get(metaPluginId) || [];
          handlers.push(cleanup);
          this.cleanupHandlers.set(metaPluginId, handlers);
        },
        registerSubscriptionSpecs: () => {
          // No-op in this single-plugin registration path; ordering
          // only matters during full-system load (plugin-loader).
        },
        getExtensionPoint: <T>(ref: ExtensionPoint<T>) =>
          this.extensionPointManager.getExtensionPoint(ref),
        registerRouter: (router: unknown, contract: AnyContractRouter) => {
          this.pluginRpcRouters.set(metaPluginId, router);
          this.pluginContractRegistry.set(metaPluginId, contract);
        },
        pluginManager: {
          getAllAccessRules: () => this.getAllAccessRules(),
        },
      });

      // 2.5. Run this plugin's Drizzle migrations into its isolated schema
      // before init, so its tables exist when the service issues its first
      // query. Mirrors the full-system loader; a runtime-installed plugin
      // ships its `drizzle/` folder inside the package.
      const migrationsFolder = path.join(pluginPath, "drizzle");
      if (fs.existsSync(migrationsFolder)) {
        stripPublicSchemaFromMigrations(migrationsFolder);
        await runPluginMigrations({
          pool: adminPool,
          migrationsFolder,
          migrationsSchema: getPluginSchemaName(metaPluginId),
        });
      }

      // 3. Initialize plugin (Phase 2)
      for (const pending of pendingInits) {
        await pending.init();
      }

      // 4. Emit pluginInitialized
      await eventBus.emit(coreHooks.pluginInitialized, { pluginId });

      // 5. Emit pluginInstalled
      await eventBus.emit(coreHooks.pluginInstalled, { pluginId });

      rootLogger.info(`✅ Plugin loaded at runtime: ${pluginId}`);
    } catch (error) {
      rootLogger.error(`❌ Failed to load plugin ${pluginId}:`, error);
      throw error;
    }
  }
}
